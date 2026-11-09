import type { SqliteDatabase } from "../../../../db/database.js";
import type { Player, Tactic } from "./types.js";

export type PlayerPositions = Map<number, Map<string, number>>;

interface FixtureDateRow {
  date: string | null;
}

interface PlayerPositionRow {
  player_id: number;
  position_code: string;
  rating: number;
}

export function loadTactic(
  db: SqliteDatabase,
  clubId: number
): Tactic {
  const tactic = db
    .prepare<[number], Tactic>(`
      SELECT
        formation_id,
        mentality,
        pressing,
        tempo,
        defensive_line,
        width,
        passing_directness,
        counter_attack
      FROM team_tactic
      WHERE club_id = ?
    `)
    .get(clubId);

  if (!tactic) {
    throw new Error(
      `Tactics for club ${clubId} were not found.`
    );
  }

  return tactic;
}

export function loadPlayers(
  db: SqliteDatabase,
  clubId: number,
  fixtureId: number
): Player[] {
  const date = db
    .prepare<[number], FixtureDateRow>(`
      SELECT
        substr(scheduled_at, 1, 10) AS date
      FROM fixture
      WHERE id = ?
    `)
    .get(fixtureId);

  const available=db.prepare(`SELECT p.person_id AS id,pe.full_name AS name,p.goalkeeper,
    COALESCE(pc.energy,100) energy,COALESCE(pc.morale,50) morale,COALESCE(pc.sharpness,50) sharpness,
    pa.pace,pa.stamina,pa.strength,pa.positioning,pa.decisions,pa.composure,pa.teamwork,pa.work_rate,
    pa.passing,pa.vision,pa.crossing,pa.dribbling,pa.finishing,pa.long_shots,pa.heading,pa.tackling,
    pa.marking,pa.aggression,pa.concentration,pa.reflexes,pa.handling,pa.aerial_reach
    FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id JOIN person pe ON pe.id=p.person_id
    JOIN player_attribute pa ON pa.player_id=p.person_id LEFT JOIN player_condition pc ON pc.player_id=p.person_id
    WHERE sm.club_id=? AND COALESCE(pc.suspension_matches,0)=0
      AND (pc.injured_until IS NULL OR ? IS NULL OR date(pc.injured_until)<date(?))
    ORDER BY p.person_id`).all(clubId,date?.date??null,date?.date??null) as Player[];
   if(available.length>=11) return available;
   const fallback=db.prepare(`SELECT p.person_id AS id,pe.full_name AS name,p.goalkeeper,
    COALESCE(pc.energy,100) energy,COALESCE(pc.morale,50) morale,COALESCE(pc.sharpness,50) sharpness,
    pa.pace,pa.stamina,pa.strength,pa.positioning,pa.decisions,pa.composure,pa.teamwork,pa.work_rate,
    pa.passing,pa.vision,pa.crossing,pa.dribbling,pa.finishing,pa.long_shots,pa.heading,pa.tackling,
    pa.marking,pa.aggression,pa.concentration,pa.reflexes,pa.handling,pa.aerial_reach,
    CASE WHEN pc.injured_until IS NOT NULL AND ? IS NOT NULL AND date(pc.injured_until)>=date(?) THEN 1 ELSE 0 END AS injuryFallback
    FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id JOIN person pe ON pe.id=p.person_id
    JOIN player_attribute pa ON pa.player_id=p.person_id LEFT JOIN player_condition pc ON pc.player_id=p.person_id
    WHERE sm.club_id=? AND COALESCE(pc.suspension_matches,0)=0 ORDER BY p.person_id
   `).all(date?.date??null,date?.date??null,clubId) as Array<Player&{injuryFallback:number}>;
   return fallback.map(({injuryFallback,...player})=>injuryFallback
    ? {...player,energy:Math.min(player.energy,40),sharpness:Math.min(player.sharpness,25)}
    : player);
}

export function loadPositions(
  db: SqliteDatabase,
  clubId: number
): PlayerPositions {
  const rows = db
    .prepare<[number], PlayerPositionRow>(`
      SELECT
        pp.player_id,
        pp.position_code,
        pp.rating
      FROM player_position pp
      JOIN squad_membership sm
        ON sm.player_id = pp.player_id
      WHERE sm.club_id = ?
    `)
    .all(clubId);

  const output: PlayerPositions = new Map();

  for (const row of rows) {
    if (!output.has(row.player_id)) {
      output.set(row.player_id, new Map());
    }

    output
      .get(row.player_id)!
      .set(row.position_code, row.rating);
  }

  return output;
}

export function bestPosition(
  id: number,
  positions: PlayerPositions
): string {
  return [
    ...(positions.get(id)?.entries() ?? []),
  ].sort(
    (a, b) => b[1] - a[1]
  )[0]?.[0] ?? "CM";
}