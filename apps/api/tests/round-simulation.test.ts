import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { open, validate } from "../db/database.js";
import { SaveManager } from "../modules/saves/repo/save-manager.js";
import {
  advanceFixtureRound, ensureFactoryLeagueCalendar, ensureFactorySquadProfiles,
  ensureFactoryWorld16, listClubs,
} from "../modules/gameplay/gameplay.facade.js";
import { simulateMatch } from "../modules/matches/service/match-simulation.service.js";
import { advanceRoundById } from "../modules/competitions/service/calendar.service.js";

test("play advances every pending match in the managed club's round", async () => {
  const root = mkdtempSync(join(tmpdir(), "manager-game-round-"));
  const masterPath = join(root, "master.sqlite");
  const schemaPath = resolve("apps/api/modules/world/schema/game_manager_mvp.sql");
  const master = open(masterPath);
  try {
    master.exec(readFileSync(schemaPath, "utf8"));
    ensureFactoryWorld16(master);
    ensureFactoryLeagueCalendar(master);
    ensureFactorySquadProfiles(master);
    validate(master);
  } finally {
    master.close();
  }

  const manager = new SaveManager(masterPath, join(root, "saves"));
  const masterReadOnly = open(masterPath, true);
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
    validate(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test("finishing the managed fixture simulates the remaining fixtures in that round", async () => {
  const root = mkdtempSync(join(tmpdir(), "manager-game-managed-round-"));
  const masterPath = join(root, "master.sqlite");
  const schemaPath = resolve("apps/api/modules/world/schema/game_manager_mvp.sql");
  const master = open(masterPath);
  try {
    master.exec(readFileSync(schemaPath, "utf8"));
    ensureFactoryWorld16(master);
    ensureFactoryLeagueCalendar(master);
    ensureFactorySquadProfiles(master);
    validate(master);
  } finally {
    master.close();
  }

  const manager = new SaveManager(masterPath, join(root, "saves"));
  const masterReadOnly = open(masterPath, true);
  let clubId: number;
  try { clubId = listClubs(masterReadOnly)[0]!.id; } finally { masterReadOnly.close(); }
  const save = await manager.create({ name: "Managed Round", managerName: "Test Manager", clubId });
  const db = manager.open(save.filePath);
  try {
    const fixture = db.prepare(`
      SELECT f.id, f.round_id AS roundId, r.stage_id AS stageId
      FROM fixture f JOIN competition_round r ON r.id=f.round_id
      WHERE f.status='SCHEDULED' AND (f.home_club_id=? OR f.away_club_id=?)
      ORDER BY f.scheduled_at,f.id LIMIT 1
    `).get(clubId, clubId) as { id:number; roundId:number; stageId:number };
    const fixturesBefore = db.prepare(
      "SELECT id FROM fixture WHERE round_id=? AND status IN ('SCHEDULED','IN_PROGRESS') ORDER BY id",
    ).all(fixture.roundId) as Array<{id:number}>;
    assert.ok(fixturesBefore.length > 1);

    const ownResult = simulateMatch(db, fixture.id, 90);
    assert.equal(ownResult.minutes, 90);
    assert.equal((db.prepare("SELECT status FROM fixture WHERE id=?").get(fixture.id) as {status:string}).status, "COMPLETED");

    const remaining = advanceRoundById(db, fixture.roundId, fixture.stageId);
    assert.equal(remaining.length, fixturesBefore.length - 1);
    assert.ok(remaining.every(result => result.fixtureId !== fixture.id));
    const roundState = db.prepare(
      "SELECT COUNT(*) AS total,SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed FROM fixture WHERE round_id=?",
    ).get(fixture.roundId) as {total:number;completed:number};
    assert.equal(roundState.completed, roundState.total);

    const completedBeforeRetry = (db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE round_id=? AND status='COMPLETED'").get(fixture.roundId) as {count:number}).count;
    assert.throws(() => advanceRoundById(db, fixture.roundId, fixture.stageId), /already completed/);
    const completedAfterRetry = (db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE round_id=? AND status='COMPLETED'").get(fixture.roundId) as {count:number}).count;
    assert.equal(completedAfterRetry, completedBeforeRetry);
    validate(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});
