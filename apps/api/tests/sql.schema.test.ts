import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { open } from "../db/database.js";

test("complete schema and seeds execute with valid SQLite integrity", () => {
  const dir = mkdtempSync(join(tmpdir(), "manager-game-schema-"));
  const db = open(join(dir, "schema.sqlite"));
  try {
    db.exec(readFileSync(resolve("apps/api/modules/world/schema/game_manager_mvp.sql"), "utf8"));
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    const momentumColumns = db.prepare("PRAGMA table_info(match_momentum)").all() as Array<{ name: string }>;
    for (const column of [
      "home_territorial_control", "away_territorial_control",
      "home_offensive_threat", "away_offensive_threat",
      "home_defensive_stability", "away_defensive_stability",
      "home_intensity", "away_intensity",
      "home_physical_condition", "away_physical_condition",
    ]) assert.ok(momentumColumns.some(item => item.name === column), column);
    const trigger = db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_match_lineup_validate_update'").get();
    assert.ok(trigger);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM club").get() as { n: number }).n, 4);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
