import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, validateDatabase } from "../db/database.js";
import { ensureFactoryWorld16 } from "../game/gameService.js";
import { runSeasonBalanceAnalysis } from "../game/matchEngine.js";

const schemaPath = resolve("src/schema/game_manager_mvp.sql");

test("factory upgrade generates distinct tiered squads and multi-seed season diagnostics", () => {
  const root = mkdtempSync(join(tmpdir(), "manager-game-balance-"));
  const dbPath = join(root, "master.sqlite");
  const db = openDatabase(dbPath);
  try {
    db.exec(readFileSync(schemaPath, "utf8"));
    validateDatabase(db);
    const upgrade = ensureFactoryWorld16(db);
    assert.equal(upgrade.clubs, 16);
    assert.equal(upgrade.leagueFixtures, 240);
    assert.equal((db.prepare("SELECT COUNT(*) AS count FROM factory_balance_metadata WHERE profile_version=1").get() as {count:number}).count, 1);

    const tierCounts = db.prepare(`
      SELECT CASE
        WHEN reputation >= 80 THEN 'ELITE'
        WHEN reputation >= 75 THEN 'COMPETITIVE'
        WHEN reputation >= 70 THEN 'MID_TABLE'
        ELSE 'LOWER_TABLE'
      END AS tier, COUNT(*) AS count
      FROM club GROUP BY tier ORDER BY tier
    `).all() as Array<{tier:string;count:number}>;
    assert.deepEqual(Object.fromEntries(tierCounts.map(row => [row.tier,row.count])), {
      COMPETITIVE: 4, ELITE: 3, LOWER_TABLE: 4, MID_TABLE: 5
    });

    const qualitySpread = db.prepare(`
      SELECT sm.club_id AS clubId, AVG(pa.passing) AS passing, AVG(pa.finishing) AS finishing,
        AVG(pa.tackling) AS tackling
      FROM squad_membership sm JOIN player_attribute pa ON pa.player_id=sm.player_id
      GROUP BY sm.club_id ORDER BY sm.club_id
    `).all() as Array<{clubId:number;passing:number;finishing:number;tackling:number}>;
    assert.equal(qualitySpread.length, 16);
    assert.ok(new Set(qualitySpread.map(row => Math.round(row.passing * 10))).size >= 8,
      "clubs should not reuse the same passing profile");
    assert.ok(new Set(qualitySpread.map(row => Math.round(row.finishing * 10))).size >= 8,
      "clubs should not reuse the same finishing profile");

    // Re-running master initialization must not silently reroll player ratings.
    const before = db.prepare("SELECT pace,finishing,tackling FROM player_attribute WHERE player_id=1").get();
    ensureFactoryWorld16(db);
    assert.deepEqual(db.prepare("SELECT pace,finishing,tackling FROM player_attribute WHERE player_id=1").get(), before);

    const report = runSeasonBalanceAnalysis(db, 2, 9127);
    assert.equal(report.seasons, 2);
    assert.equal(report.totalMatches, 480);
    assert.equal(report.clubs.length, 16);
    assert.deepEqual(report.tierSummary.map(row => row.clubs), [3,4,5,4]);
    assert.ok(report.clubs.every(row => Number.isFinite(row.averagePoints)));
    assert.ok(report.favoriteWinRate >= 0 && report.favoriteWinRate <= 1);
    assert.ok(report.underdogWinRate >= 0 && report.underdogWinRate <= 1);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
