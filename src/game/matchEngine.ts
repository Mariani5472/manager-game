import type { SqliteDatabase } from "../db/database.js";
import { randomInt } from "node:crypto";

export interface MatchSummary {
  fixtureId: number;
  homeClubId: number;
  awayClubId: number;
  homeScore: number;
  awayScore: number;
  events: number;
  minutes: number;
}

interface FixtureRow {
  id: number;
  home_club_id: number;
  away_club_id: number;
  random_seed: number | null;
  status: string;
  current_minute: number;
  home_score: number | null;
  away_score: number | null;
}

interface TeamStrength {
  club_id: number;
  reputation: number;
  average_attribute: number;
  energy: number;
  morale: number;
  tactical_bias: number;
}

function seededRandom(seed: number): () => number {
  // mulberry32: compact deterministic PRNG; state is serializable for checkpoints.
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadTeamStrength(db: SqliteDatabase, clubId: number): TeamStrength {
  const row = db.prepare(`
    SELECT c.id AS club_id,
           c.reputation,
           COALESCE(AVG((pa.pace + pa.passing + pa.finishing + pa.positioning + pa.decisions + pa.stamina) / 6.0), 50) AS average_attribute,
           COALESCE(AVG(pc.energy), 100) AS energy,
           COALESCE(AVG(pc.morale), 50) AS morale,
           COALESCE(tt.pressing, 50) * 0.05 + COALESCE(tt.tempo, 50) * 0.03 AS tactical_bias
    FROM club c
    LEFT JOIN squad_membership sm ON sm.club_id = c.id
    LEFT JOIN player_attribute pa ON pa.player_id = sm.player_id
    LEFT JOIN player_condition pc ON pc.player_id = sm.player_id
    LEFT JOIN team_tactic tt ON tt.club_id = c.id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(clubId) as TeamStrength | undefined;
  if (!row) throw new Error(`Club ${clubId} not found.`);
  return row;
}

/**
 * Deliberately small first-pass engine:
 * - deterministic per fixture seed;
 * - minute-by-minute event/momentum output;
 * - results/events/checkpoints committed atomically.
 * It is a foundation to replace with the full event-based tactical model.
 */
export function simulateMatch(db: SqliteDatabase, fixtureId: number): MatchSummary {
  const fixture = db.prepare("SELECT * FROM fixture WHERE id = ?").get(fixtureId) as FixtureRow | undefined;
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found.`);
  if (fixture.status === "COMPLETED") throw new Error(`Fixture ${fixtureId} is already completed.`);
  if (fixture.status === "CANCELLED" || fixture.status === "POSTPONED") {
    throw new Error(`Fixture ${fixtureId} is not playable (status: ${fixture.status}).`);
  }

  const seed = fixture.random_seed ?? (fixture.id * 2654435761 >>> 0);
  const random = seededRandom(seed);
  const home = loadTeamStrength(db, fixture.home_club_id);
  const away = loadTeamStrength(db, fixture.away_club_id);
  let homeScore = 0;
  let awayScore = 0;
  const events: Array<{ minute: number; clubId: number | null; playerId: number | null; type: string; xg: number; description: string }> = [];

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM match_event WHERE fixture_id = ?").run(fixtureId);
    db.prepare("DELETE FROM match_momentum WHERE fixture_id = ?").run(fixtureId);
    db.prepare("DELETE FROM match_simulation_state WHERE fixture_id = ?").run(fixtureId);
    db.prepare("DELETE FROM match_player_state WHERE fixture_id = ?").run(fixtureId);

    const homeScorers = db.prepare("SELECT sm.player_id FROM squad_membership sm WHERE sm.club_id = ? ORDER BY sm.player_id");
    const awayScorers = db.prepare("SELECT sm.player_id FROM squad_membership sm WHERE sm.club_id = ? ORDER BY sm.player_id");
    const homePlayers = homeScorers.all(fixture.home_club_id) as Array<{ player_id: number }>;
    const awayPlayers = awayScorers.all(fixture.away_club_id) as Array<{ player_id: number }>;
    const homePlayers = homeScorers.all(fixture.home_club_id) as Array<{ player_id: number }>;
    const awayPlayers = awayScorers.all(fixture.away_club_id) as Array<{ player_id: number }>;
    const insertEvent = db.prepare(`
      INSERT INTO match_event (fixture_id, minute, club_id, player_id, event_type, xg, description)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMomentum = db.prepare(`
      INSERT INTO match_momentum (fixture_id, minute, home_pressure, away_pressure, home_score, away_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const updateFixture = db.prepare(`
      UPDATE fixture SET status = ?, current_minute = ?, home_score = ?, away_score = ?
      WHERE id = ?
    `);

    insertEvent.run(fixtureId, 0, null, null, "KICK_OFF", 0, "Partida iniciada");
    for (let minute = 1; minute <= 90; minute += 1) {
      const homeFatigue = (100 - home.energy) * 0.12;
      const awayFatigue = (100 - away.energy) * 0.12;
      const homeChance = clamp(0.022 + (home.reputation - away.reputation) / 7000 +
        (home.average_attribute - away.average_attribute) / 3500 + 0.012 - homeFatigue / 1000, 0.006, 0.055);
      const awayChance = clamp(0.018 + (away.reputation - home.reputation) / 7000 +
        (away.average_attribute - home.average_attribute) / 3500 - awayFatigue / 1000, 0.004, 0.05);
      const homePressure = clamp((homeChance * 1000) + random() * 18, 0, 100);
      const awayPressure = clamp((awayChance * 1000) + random() * 18, 0, 100);
      insertMomentum.run(fixtureId, minute, homePressure, awayPressure, homeScore, awayScore);

      for (const side of [
        { strength: home, chance: homeChance, clubId: fixture.home_club_id, players: homePlayers },
        { strength: away, chance: awayChance, clubId: fixture.away_club_id, players: awayPlayers },
      ]) {
        if (random() < side.chance) {
          const shotOnTarget = random() < clamp(0.28 + side.strength.average_attribute / 250, 0.3, 0.68);
          const scored = shotOnTarget && random() < clamp(0.1 + side.strength.average_attribute / 230, 0.15, 0.55);
          const player = side.players.length ? side.players[Math.floor(random() * side.players.length)] : undefined;
          if (scored) {
            if (side.clubId === fixture.home_club_id) homeScore += 1;
            else awayScore += 1;
          }
          const type = scored ? "GOAL" : shotOnTarget ? "SHOT_ON_TARGET" : "SHOT";
          events.push({
            minute,
            clubId: side.clubId,
            playerId: player?.player_id ?? null,
            type,
            xg: scored ? 0.25 : shotOnTarget ? 0.15 : 0.04,
            description: scored ? "GOL!" : shotOnTarget ? "Finalização defendida" : "Finalização para fora",
          });
        }
      }

      // Each minute has its own momentum point; update score again after scoring events.
      db.prepare(`
        UPDATE match_momentum SET home_score = ?, away_score = ?
        WHERE fixture_id = ? AND minute = ?
      `).run(homeScore, awayScore, fixtureId, minute);
    }
    for (const event of events) {
      insertEvent.run(fixtureId, event.minute, event.clubId, event.playerId, event.type, event.xg, event.description);
    }
    insertEvent.run(fixtureId, 90, null, null, "FULL_TIME", 0, "Fim de jogo");
    updateFixture.run("COMPLETED", 90, homeScore, awayScore, fixtureId);

    for (const clubId of [fixture.home_club_id, fixture.away_club_id]) {
      db.prepare(`
        UPDATE player_condition SET energy = MAX(0, energy - 12)
        WHERE player_id IN (SELECT player_id FROM squad_membership WHERE club_id = ?)
      `).run(clubId);
    }
    db.prepare("DELETE FROM match_simulation_state WHERE fixture_id = ?").run(fixtureId);
  });
  tx();

  return {
    fixtureId,
    homeClubId: fixture.home_club_id,
    awayClubId: fixture.away_club_id,
    homeScore,
    awayScore,
    events: events.length + 2,
    minutes: 90,
  };
}
