import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, validateDatabase } from "../db/database.js";
import { SaveManager } from "../save/saveManager.js";
import { previewLineup, saveLineup } from "../game/lineupService.js";
import { scheduleMatchTacticalChange, simulateMatch } from "../game/matchEngine.js";
import { resolveMatchContext } from "../game/matchContext.js";

const schemaPath = resolve("src/schema/game_manager_mvp.sql");

test("match context persists weather and pitch, applies substitutions as events, and advances suspensions", async () => {
  const root = mkdtempSync(join(tmpdir(), "manager-game-phase6-"));
  const masterPath = join(root, "master.sqlite");
  const master = openDatabase(masterPath);
  try {
    master.exec(readFileSync(schemaPath, "utf8"));
    validateDatabase(master);
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

    const starter = preview.starters.find(p=>p.position!=="GK")!;
    const substitute = preview.bench.find(p=>p.position!=="GK")!;
    scheduleMatchTacticalChange(db, fixture.id, fixture.home, 60, "SUBSTITUTION", {
      playerOutId: starter.playerId, playerInId: substitute.playerId
    });
    scheduleMatchTacticalChange(db, fixture.id, fixture.home, 70, "MENTALITY", { mentality: "ATTACKING" });

    const result = simulateMatch(db, fixture.id);
    assert.equal(result.minutes, 90);
    assert.equal((db.prepare("SELECT weather FROM match_environment WHERE fixture_id=?").get(fixture.id) as {weather:string}).weather, "HEAVY_RAIN");
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=? AND event_type='SUBSTITUTION' AND minute=60").get(fixture.id) as {count:number}).count, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=? AND event_type='TACTIC_CHANGE' AND minute=70").get(fixture.id) as {count:number}).count, 1);
    assert.equal((db.prepare("SELECT suspension_matches AS value FROM player_condition WHERE player_id=?").get(suspended.id) as {value:number}).value, 1);
    assert.equal((db.prepare("SELECT applied FROM match_tactical_change WHERE fixture_id=? AND minute=60").get(fixture.id) as {applied:number}).applied, 1);
    const subState = db.prepare("SELECT minutes_played AS minutes FROM match_player_state WHERE fixture_id=? AND player_id=?").get(fixture.id, substitute.playerId) as {minutes:number};
    assert.equal(subState.minutes, 30);
    validateDatabase(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
