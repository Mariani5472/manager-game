import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { open, validate } from "../db/database.js";
import { SaveManager } from "../modules/saves/repo/save-manager.js";
import { previewLineup, saveLineup } from "../modules/campaign/repo/lineup.repository.js";
import { scheduleMatchTacticalChange, simulateMatch } from "../modules/matches/engine/match-engine.facade.js";
import { resolveMatchContext } from "../modules/matches/service/match-context.service.js";

const schemaPath = resolve("apps/api/modules/world/schema/game_manager_mvp.sql");

test("match context persists weather and pitch, applies substitutions as events, and advances suspensions", async () => {
  const root = mkdtempSync(join(tmpdir(), "manager-game-phase6-"));
  const masterPath = join(root, "master.sqlite");
  const master = open(masterPath);
  try {
    master.exec(readFileSync(schemaPath, "utf8"));
    validate(master);
  } finally { master.close(); }

  const manager = new SaveManager(masterPath, join(root, "saves"));
  const save = await manager.create({ name: "Phase 6 Test", managerName: "Test Manager", clubId: 1 });
  const db = manager.open(save.filePath);
  try {
    const fixture = db.prepare("SELECT id,home_club_id AS home,away_club_id AS away FROM fixture WHERE status='SCHEDULED' ORDER BY id LIMIT 1")
      .get() as { id:number; home:number; away:number };
    const preview = previewLineup(db, fixture.home, fixture.id);
    assert.equal(preview.starters.length, 11);
    assert.ok(preview.bench.length > 0);
    saveLineup(db, fixture.id, fixture.home, preview.starters.map(p=>p.playerId), preview.bench.map(p=>p.playerId));


    // Match preparation must reject malformed ids and become immutable once
    // the simulation checkpoint has been created.
    assert.throws(
      () => saveLineup(db, fixture.id, fixture.home, [...preview.starters.slice(0, 10).map(p => p.playerId), -1], preview.bench.map(p => p.playerId)),
      /positive integers/,
    );
    assert.throws(
      () => saveLineup(db, fixture.id, fixture.home, preview.starters.map(p => p.playerId), [preview.starters[0]!.playerId]),
      /appear twice/,
    );

    const prior = db.prepare("SELECT id FROM fixture WHERE id<>? AND (home_club_id=? OR away_club_id=?) ORDER BY id LIMIT 1").get(fixture.id,fixture.home,fixture.home) as {id:number}|undefined;
    if (prior) {
      db.prepare("UPDATE fixture SET status='COMPLETED',home_score=0,away_score=0,scheduled_at='2026-01-01T12:00:00' WHERE id=?").run(prior.id);
      db.prepare("UPDATE fixture SET scheduled_at='2026-01-02T12:00:00' WHERE id=?").run(fixture.id);
    }
    const stadiumCity = db.prepare("SELECT city_id AS id FROM stadium WHERE id=(SELECT stadium_id FROM fixture WHERE id=?)").get(fixture.id) as {id:number}|undefined;
    const otherCity = stadiumCity ? db.prepare("SELECT id FROM city WHERE id<>? ORDER BY id LIMIT 1").get(stadiumCity.id) as {id:number}|undefined : undefined;
    if (stadiumCity?.id && otherCity) {
      db.prepare("UPDATE club SET city_id=? WHERE id=?").run(otherCity.id,fixture.away);
      db.prepare("INSERT OR REPLACE INTO travel_route(from_city_id,to_city_id,distance_km,estimated_hours,travel_mode) VALUES(?,?,600,8,'PLANE')").run(otherCity.id,stadiumCity.id);
    }
    db.prepare("INSERT INTO match_environment(fixture_id,weather,temperature_c,pitch_condition) VALUES(?,?,?,?)")
      .run(fixture.id, "HEAVY_RAIN", 16, 35);
    const context = resolveMatchContext(db, fixture.id, fixture.home);
    assert.equal(context.weather, "HEAVY_RAIN");
    assert.equal(context.pitchCondition, 35);
    if (prior) assert.ok(context.restHours <= 24, "short rest should be derived from the previous fixture date");
    if (stadiumCity?.id && otherCity) {
      const awayContext = resolveMatchContext(db, fixture.id, fixture.away);
      assert.equal(awayContext.travelKm, 600);
      assert.equal(awayContext.travelHours, 8);
    }

    const suspended = db.prepare("SELECT player_id AS id FROM squad_membership WHERE club_id=? ORDER BY player_id LIMIT 1")
      .get(fixture.away) as {id:number};
    db.prepare("UPDATE player_condition SET suspension_matches=2 WHERE player_id=?").run(suspended.id);

    // Use the persisted match lineup as the source of truth for live decisions.
    const starter = db.prepare(
      "SELECT player_id AS playerId FROM match_lineup WHERE fixture_id=? AND club_id=? AND is_starting=1 AND position_code<>'GK' ORDER BY slot_number LIMIT 1",
    ).get(fixture.id, fixture.home) as {playerId:number};
    const substitute = db.prepare(
      "SELECT player_id AS playerId FROM match_lineup WHERE fixture_id=? AND club_id=? AND is_starting=0 ORDER BY slot_number LIMIT 1",
    ).get(fixture.id, fixture.home) as {playerId:number};
    assert.ok(starter.playerId > 0);
    assert.ok(substitute.playerId > 0);
    scheduleMatchTacticalChange(db, fixture.id, fixture.home, 1, "SUBSTITUTION", {
      playerOutId: starter.playerId, playerInId: substitute.playerId
    });
    scheduleMatchTacticalChange(db, fixture.id, fixture.home, 70, "MENTALITY", { mentality: "ATTACKING" });
    const formation = db.prepare("SELECT formation_id AS id FROM team_tactic WHERE club_id=?").get(fixture.home) as {id:number};
    scheduleMatchTacticalChange(db, fixture.id, fixture.home, 80, "FORMATION", { formationId: formation.id });
    // The campaign endpoint must use the save's selected club even when it is
    // the away side. Tactical choices for the opposite side are not permitted.
    const managedAwayClubId = fixture.away;
    const awayLineup = previewLineup(db, managedAwayClubId, fixture.id);
    saveLineup(db, fixture.id, managedAwayClubId,
      awayLineup.starters.map(player => player.playerId),
      awayLineup.bench.map(player => player.playerId),
    );
    const awayStarter = db.prepare(
      "SELECT player_id AS playerId FROM match_lineup WHERE fixture_id=? AND club_id=? AND is_starting=1 AND position_code<>'GK' ORDER BY slot_number LIMIT 1",
    ).get(fixture.id, managedAwayClubId) as {playerId:number};
    const awayBench = db.prepare(
      "SELECT player_id AS playerId FROM match_lineup WHERE fixture_id=? AND club_id=? AND is_starting=0 ORDER BY slot_number LIMIT 1",
    ).get(fixture.id, managedAwayClubId) as {playerId:number};
    const awayDecisionId = scheduleMatchTacticalChange(
      db, fixture.id, managedAwayClubId, 85, "SUBSTITUTION",
      { playerOutId: awayStarter.playerId, playerInId: awayBench.playerId },
    );
    assert.ok(awayDecisionId > 0);
    assert.throws(
      () => scheduleMatchTacticalChange(db, fixture.id, fixture.home, 86, "SUBSTITUTION",
        { playerOutId: awayStarter.playerId, playerInId: awayBench.playerId }),
      /Both players must belong to the selected club/,
    );



    // Decisions may be appended during playback, but only for future minutes.
    simulateMatch(db, fixture.id, 20);
    const lateSubstitutionStarter = db.prepare("SELECT player_id AS id FROM match_lineup WHERE fixture_id=? AND club_id=? AND is_starting=1 AND position_code<>'GK' AND player_id<>? ORDER BY slot_number LIMIT 1").get(fixture.id, fixture.home, starter.playerId) as { id:number };
    const lateSubstitutionBench = db.prepare("SELECT player_id AS id FROM match_lineup WHERE fixture_id=? AND club_id=? AND is_starting=0 AND position_code='BENCH' AND player_id<>? ORDER BY slot_number LIMIT 1").get(fixture.id, fixture.home, substitute.playerId) as { id:number };
    const lateDecisionId = scheduleMatchTacticalChange(db, fixture.id, fixture.home, 40, "SUBSTITUTION", {
      playerOutId: lateSubstitutionStarter.id, playerInId: lateSubstitutionBench.id
    });
    assert.ok(lateDecisionId > 0);
    assert.throws(
      () => scheduleMatchTacticalChange(db, fixture.id, fixture.home, 20, "MENTALITY", { mentality: "ATTACKING" }),
      /current minute/,
    );

    const result = simulateMatch(db, fixture.id);
    assert.equal(result.minutes, 90);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=? AND event_type='TACTIC_CHANGE' AND minute=70").get(fixture.id) as {count:number}).count, 1);
    assert.equal((db.prepare("SELECT weather FROM match_environment WHERE fixture_id=?").get(fixture.id) as {weather:string}).weather, "HEAVY_RAIN");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=? AND event_type='SUBSTITUTION' AND minute=1").get(fixture.id) as {count:number}).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=? AND event_type='TACTIC_CHANGE' AND minute=70").get(fixture.id) as {count:number}).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=? AND event_type='TACTIC_CHANGE' AND minute=80").get(fixture.id) as {count:number}).count, 1);
    assert.equal((db.prepare("SELECT suspension_matches AS value FROM player_condition WHERE player_id=?").get(suspended.id) as {value:number}).value, 1);
    assert.equal((db.prepare("SELECT applied FROM match_tactical_change WHERE fixture_id=? AND minute=1").get(fixture.id) as {applied:number}).applied, 1);
    const subState = db.prepare("SELECT minutes_played AS minutes FROM match_player_state WHERE fixture_id=? AND player_id=?").get(fixture.id, substitute.playerId) as {minutes:number};
    assert.ok(subState.minutes >= 0 && subState.minutes <= 89);
    const lateDecisionOutcome = db.prepare(
      "SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=? AND minute=40 AND event_type IN ('SUBSTITUTION','TACTIC_CHANGE') AND description LIKE '%Substituição%'",
    ).get(fixture.id) as {count:number};
    assert.equal(lateDecisionOutcome.count, 1);
    validate(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
