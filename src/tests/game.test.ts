import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, validateDatabase } from "../db/database.js";
import { SaveManager } from "../save/saveManager.js";
import { advanceNextFixture, listFixtures } from "../game/gameService.js";

const schemaPath = resolve("src/schema/game_manager_mvp.sql");
const schemaText = readFileSync(schemaPath, "utf8");

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "manager-game-test-"));
}

function createMaster(root: string): string {
  const path = join(root, "master.sqlite");
  const db = openDatabase(path);
  try {
    db.exec(schemaText);
    validateDatabase(db);
  } finally {
    db.close();
  }
  return path;
}

test("schema initializes and foreign keys are valid", () => {
  const root = createTempRoot();
  try {
    const master = createMaster(root);
    const db = openDatabase(master, true);
    try {
      assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(db.pragma("foreign_key_check"), []);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("independent saves do not share mutable state", () => {
  const root = createTempRoot();
  try {
    const master = createMaster(root);
    const manager = new SaveManager(master, join(root, "saves"));
    const a = manager.create({ name: "Campaign A", managerName: "Alex", clubId: 1 });
    const b = manager.create({ name: "Campaign B", managerName: "Bea", clubId: 2 });
    const dbA = manager.open(a.filePath);
    const dbB = manager.open(b.filePath);
    try {
      advanceNextFixture(dbA, 1);
      assert.equal(
        (dbA.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status,
        "COMPLETED",
      );
      assert.equal(
        (dbB.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status,
        "SCHEDULED",
      );
      const masterDb = openDatabase(master, true);
      try {
        assert.equal(
          (masterDb.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status,
          "SCHEDULED",
        );
      } finally { masterDb.close(); }
    } finally { dbA.close(); dbB.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("same fixture seed yields same result in independent saves", () => {
  const root = createTempRoot();
  try {
    const master = createMaster(root);
    const manager = new SaveManager(master, join(root, "saves"));
    const a = manager.create({ name: "Deterministic A", managerName: "Alex", clubId: 1 });
    const b = manager.create({ name: "Deterministic B", managerName: "Bea", clubId: 2 });
    const dbA = manager.open(a.filePath);
    const dbB = manager.open(b.filePath);
    try {
      const resultA = advanceNextFixture(dbA, 1);
      const resultB = advanceNextFixture(dbB, 1);
      assert.equal(resultA.homeScore, resultB.homeScore);
      assert.equal(resultA.awayScore, resultB.awayScore);
      assert.equal(resultA.events, resultB.events);
      assert.equal(listFixtures(dbA, true).length, 5);
    } finally { dbA.close(); dbB.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("simulated match writes final score, events, momentum and conditions", () => {
  const root = createTempRoot();
  try {
    const master = createMaster(root);
    const manager = new SaveManager(master, join(root, "saves"));
    const save = manager.create({ name: "Match Test", managerName: "Tester", clubId: 1 });
    const db = manager.open(save.filePath);
    try {
      const result = advanceNextFixture(db, 1);
      assert.equal(result.minutes, 90);
      assert.equal((db.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status, "COMPLETED");
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM match_momentum WHERE fixture_id=1").get() as {n:number}).n, 90);
      assert.ok((db.prepare("SELECT COUNT(*) AS n FROM match_event WHERE fixture_id=1").get() as {n:number}).n >= 2);
      assert.ok((db.prepare("SELECT AVG(energy) AS n FROM player_condition WHERE player_id BETWEEN 1 AND 18").get() as {n:number}).n < 100);
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
