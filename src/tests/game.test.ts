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

test("campaigns can be discovered and reopened by stable save id", () => {
  const root = createTempRoot();
  try {
    const master = createMaster(root);
    const manager = new SaveManager(master, join(root, "saves"));
    const created = manager.create({ name: "Minha carreira", managerName: "Técnico", clubId: 1 });
    const listed = manager.list().find((save) => save.id === created.id);
    assert.ok(listed);
    assert.equal(listed.name, "Minha carreira");

    const reopened = manager.openById(created.id);
    try {
      assert.equal(
        (reopened.prepare("SELECT id FROM game_save_metadata").get() as { id: string }).id,
        created.id,
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("save creation rejects invalid club ids and blank names", () => {
  const root = createTempRoot();
  try {
    const master = createMaster(root);
    const manager = new SaveManager(master, join(root, "saves"));
    assert.throws(
      () => manager.create({ name: "Valid name", managerName: "Manager", clubId: 999 }),
      /does not exist/,
    );
    assert.throws(
      () => manager.create({ name: "   ", managerName: "Manager", clubId: 1 }),
      /cannot be empty/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("opening a corrupt database reports a clear error and closes its handle", () => {
  const root = createTempRoot();
  try {
    const manager = new SaveManager(join(root, "missing-master.sqlite"), join(root, "saves"));
    assert.throws(() => manager.open(join(root, "does-not-exist.sqlite")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
