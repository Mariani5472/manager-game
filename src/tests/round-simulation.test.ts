import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, validateDatabase } from "../db/database.js";
import { SaveManager } from "../save/saveManager.js";
import {
  advanceFixtureRound, ensureFactoryLeagueCalendar, ensureFactorySquadProfiles,
  ensureFactoryWorld16, listClubs,
} from "../game/gameService.js";

test("play advances every pending match in the managed club's round", async () => {
  const root = mkdtempSync(join(tmpdir(), "manager-game-round-"));
  const masterPath = join(root, "master.sqlite");
  const schemaPath = resolve("src/schema/game_manager_mvp.sql");
  const master = openDatabase(masterPath);
  try {
    master.exec(readFileSync(schemaPath, "utf8"));
    ensureFactoryWorld16(master);
    ensureFactoryLeagueCalendar(master);
    ensureFactorySquadProfiles(master);
    validateDatabase(master);
  } finally {
    master.close();
  }

  const manager = new SaveManager(masterPath, join(root, "saves"));
  const masterReadOnly = openDatabase(masterPath, true);
  let clubId: number;
  try { clubId = listClubs(masterReadOnly)[0]!.id; } finally { masterReadOnly.close(); }
  const save = await manager.create({ name: "Round Simulation", managerName: "Test Manager", clubId });
  const db = manager.open(save.filePath);
  try {
    const ownFixture = db.prepare(`
      SELECT f.id, f.round_id AS roundId
      FROM fixture f
      WHERE f.status IN ('SCHEDULED','IN_PROGRESS')
        AND (f.home_club_id=? OR f.away_club_id=?)
      ORDER BY f.scheduled_at,f.id LIMIT 1
    `).get(clubId,clubId) as {id:number;roundId:number};
    const expected = (db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE round_id=? AND status IN ('SCHEDULED','IN_PROGRESS')").get(ownFixture.roundId) as {count:number}).count;
    assert.ok(expected > 1, "fixture round should contain multiple matches");

    const results = advanceFixtureRound(db);
    assert.equal(results.length, expected, "all pending fixtures from that round are returned");
    const completed = (db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE round_id=? AND status='COMPLETED'").get(ownFixture.roundId) as {count:number}).count;
    assert.equal(completed, expected, "all matches in the round are completed");
    assert.ok(results.some(result => result.fixtureId === ownFixture.id), "the managed club's match is included");

    const before = (db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE status='COMPLETED'").get() as {count:number}).count;
    const nextResults = advanceFixtureRound(db);
    assert.ok(nextResults.every(result => result.fixtureId !== ownFixture.id), "completed matches are not simulated twice");
    const after = (db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE status='COMPLETED'").get() as {count:number}).count;
    assert.equal(after - before, nextResults.length, "only newly simulated matches are added to the completed count");
    validateDatabase(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
