import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { open } from "../db/database.js";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../db/migrations.js";

test("schema v1 migrates atomically to the current version and backfills completed fixtures", () => {
  const root = mkdtempSync(join(tmpdir(), "manager-game-migrations-"));
  const db = open(join(root, "legacy.sqlite"));
  try {
    db.exec(readFileSync(resolve("apps/api/modules/world/schema/game_manager_mvp.sql"), "utf8"));
    db.prepare("UPDATE fixture SET status='COMPLETED' WHERE id=1").run();

    assert.equal(applyMigrations(db), CURRENT_SCHEMA_VERSION);
    assert.equal(applyMigrations(db), CURRENT_SCHEMA_VERSION);

    const version = db.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    assert.equal(version.version, CURRENT_SCHEMA_VERSION);

    const fixture = db.prepare("SELECT completed_at AS completedAt,scheduled_at AS scheduledAt FROM fixture WHERE id=1")
      .get() as { completedAt: string; scheduledAt: string };
    assert.equal(fixture.completedAt, fixture.scheduledAt);

    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_preparation'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_momentum_debug'").get());
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_history_snapshot'").get());
    const historyColumns = db.prepare("PRAGMA table_info(match_history_snapshot)").all() as Array<{ name:string }>;
    for (const column of ["home_lineup_json","away_lineup_json","tactics_json","result_json","engine_version","random_seed","is_legacy","completed_at"]) assert.ok(historyColumns.some(item => item.name === column), column);
    const momentumColumns = db.prepare("PRAGMA table_info(match_momentum)").all() as Array<{ name: string }>;
    for (const column of [
      "home_territorial_control", "away_territorial_control",
      "home_offensive_threat", "away_offensive_threat",
      "home_defensive_stability", "away_defensive_stability",
      "home_intensity", "away_intensity",
      "home_physical_condition", "away_physical_condition",
    ]) assert.ok(momentumColumns.some(item => item.name === column), column);
    for (const index of [
      "idx_fixture_round_status_schedule",
      "idx_match_event_fixture_timeline",
      "idx_match_lineup_fixture_club_starting",
      "idx_match_tactical_change_pending",
    ]) {
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index), index);
    }
    assert.deepEqual(db.pragma("foreign_key_check"), []);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
