import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { open } from "../db/database.js";
import { applyMigrations, CURRENT_SCHEMA_VERSION } from "../db/migrations.js";

test("schema v1 migrates atomically to v2 and backfills completed fixtures", () => {
  const root = mkdtempSync(join(tmpdir(), "manager-game-migrations-"));
  const db = open(join(root, "legacy.sqlite"));
  try {
    db.exec(readFileSync(resolve("apps/api/modules/world/schema/game_manager_mvp.sql"), "utf8"));
    db.prepare("UPDATE fixture SET status='COMPLETED' WHERE id=1").run();

    assert.equal(applyMigrations(db), CURRENT_SCHEMA_VERSION);
    assert.equal(applyMigrations(db), CURRENT_SCHEMA_VERSION);

    const version = db.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number };
    assert.equal(version.version, 2);

    const fixture = db.prepare("SELECT completed_at AS completedAt,scheduled_at AS scheduledAt FROM fixture WHERE id=1")
      .get() as { completedAt: string; scheduledAt: string };
    assert.equal(fixture.completedAt, fixture.scheduledAt);

    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='match_preparation'").get());
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
