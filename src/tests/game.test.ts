import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { openDatabase, validateDatabase } from "../db/database.js";
import { SaveManager } from "../save/saveManager.js";
import {
  advanceNextFixture, advanceRound, getManagedClub, getSeasonStatus, getStandings,
  listFixtures, listSquad, getTactics, prepareNextLeagueSeason,
} from "../game/gameService.js";

const schemaPath = resolve("src/schema/game_manager_mvp.sql");

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "manager-game-issues-"));
}

function createMaster(root: string): string {
  const masterPath = join(root, "master.sqlite");
  const db = openDatabase(masterPath);
  try {
    db.exec(readFileSync(schemaPath, "utf8"));
    validateDatabase(db);
  } finally {
    db.close();
  }
  return masterPath;
}

async function createSave(root: string, name = "Test Campaign", clubId = 1) {
  const masterPath = createMaster(root);
  const manager = new SaveManager(masterPath, join(root, "saves"));
  const save = await manager.create({ name, managerName: "Test Manager", clubId });
  return { masterPath, manager, save };
}

test("complete schema executes and passes SQLite integrity and foreign-key checks", () => {
  const root = tempRoot();
  try {
    const masterPath = createMaster(root);
    const db = openDatabase(masterPath, true);
    try {
      assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
      assert.deepEqual(db.pragma("foreign_key_check"), []);
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='trg_match_lineup_validate_update'").get());
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("online backup captures master WAL state and a played save does not mutate master or another save", async () => {
  const root = tempRoot();
  let masterDb: ReturnType<typeof openDatabase> | undefined;
  let saveA: ReturnType<typeof openDatabase> | undefined;
  let saveB: ReturnType<typeof openDatabase> | undefined;
  try {
    const masterPath = createMaster(root);
    masterDb = openDatabase(masterPath);
    // Keep the master connection open in WAL mode while saves are created.
    masterDb.prepare("UPDATE player_condition SET energy=37 WHERE player_id=1").run();
    const manager = new SaveManager(masterPath, join(root, "saves"));
    const a = await manager.create({ name: "Campaign A", managerName: "Alex", clubId: 1 });
    const b = await manager.create({ name: "Campaign B", managerName: "Bea", clubId: 2 });
    saveA = manager.open(a.filePath);
    saveB = manager.open(b.filePath);

    assert.equal((saveA.prepare("SELECT energy FROM player_condition WHERE player_id=1").get() as {energy:number}).energy, 37);
    advanceNextFixture(saveA, 1);
    assert.equal((saveA.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status, "COMPLETED");
    assert.equal((saveB.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status, "SCHEDULED");
    assert.equal((masterDb.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status, "SCHEDULED");
    assert.equal((masterDb.prepare("SELECT energy FROM player_condition WHERE player_id=1").get() as {energy:number}).energy, 37);
  } finally {
    if (saveA?.open) saveA.close();
    if (saveB?.open) saveB.close();
    if (masterDb?.open) masterDb.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("saves can be discovered and reopened by stable id", async () => {
  const root = tempRoot();
  try {
    const { manager, save } = await createSave(root, "Minha carreira");
    const listed = manager.list().find(item => item.id === save.id);
    assert.ok(listed);
    assert.equal(listed.name, "Minha carreira");
    const reopened = manager.openById(save.id);
    try {
      assert.equal((reopened.prepare("SELECT id FROM game_save_metadata").get() as {id:string}).id, save.id);
      assert.equal((reopened.prepare("SELECT selected_club_id AS id FROM game_save_metadata").get() as {id:number}).id, 1);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("save creation rejects invalid ids and blank names without leaving partial save files", async () => {
  const root = tempRoot();
  try {
    const master = createMaster(root);
    const manager = new SaveManager(master, join(root, "saves"));
    await assert.rejects(manager.create({name:"Valid name",managerName:"Manager",clubId:999}), /does not exist/);
    await assert.rejects(manager.create({name:"   ",managerName:"Manager",clubId:1}), /cannot be empty/);
    await assert.rejects(manager.create({name:"Valid",managerName:" ",clubId:1}), /cannot be empty/);
    assert.equal(manager.list().length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("opening a master database as a save is rejected clearly", async () => {
  const root = tempRoot();
  try {
    const master = createMaster(root);
    const manager = new SaveManager(master, join(root, "saves"));
    assert.throws(() => manager.open(master), /not a Game Manager campaign save/);
    assert.throws(() => manager.openById(" "), /cannot be empty/);
    assert.throws(() => manager.openById("unknown"), /was not found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("application services expose the controlled club, squad and tactics", async () => {
  const root = tempRoot();
  try {
    const { manager, save } = await createSave(root);
    const db = manager.open(save.filePath);
    try {
      assert.equal(getManagedClub(db).id, 1);
      assert.equal(listSquad(db, 1).length, 18);
      assert.equal(getTactics(db, 1).formation, "4-3-3");
      assert.ok(getSeasonStatus(db).some(item => item.stageId === 1));
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("advancing a round plays managed and AI fixtures and rebuilds standings", async () => {
  const root = tempRoot();
  try {
    const { manager, save } = await createSave(root);
    const db = manager.open(save.filePath);
    try {
      const results = advanceRound(db, 1);
      assert.equal(results.length, 2);
      const table = getStandings(db, 1);
      assert.equal(table.reduce((sum,row) => sum + row.played, 0), 4);
      assert.deepEqual(table.map(row => row.clubId).sort((a,b) => a-b), [1,2,3,4]);
      assert.ok(table.every(row => row.played === 1));
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a completed fixture cannot be played again and its result/events remain unchanged", async () => {
  const root = tempRoot();
  try {
    const { manager, save } = await createSave(root);
    const db = manager.open(save.filePath);
    try {
      const result = advanceNextFixture(db, 1);
      const eventsBefore = (db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=1").get() as {count:number}).count;
      const momentumBefore = (db.prepare("SELECT COUNT(*) AS count FROM match_momentum WHERE fixture_id=1").get() as {count:number}).count;
      assert.throws(() => advanceNextFixture(db, 1), /Scheduled fixture/);
      assert.deepEqual(
        db.prepare("SELECT home_score AS homeScore, away_score AS awayScore FROM fixture WHERE id=1").get(),
        { homeScore: result.homeScore, awayScore: result.awayScore },
      );
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=1").get() as {count:number}).count, eventsBefore);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_momentum WHERE fixture_id=1").get() as {count:number}).count, momentumBefore);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed match persistence rolls back score, events and player condition", async () => {
  const root = tempRoot();
  try {
    const { manager, save } = await createSave(root);
    const db = manager.open(save.filePath);
    try {
      const energyBefore = (db.prepare("SELECT energy FROM player_condition WHERE player_id=1").get() as {energy:number}).energy;
      db.exec(`CREATE TRIGGER test_reject_match_event BEFORE INSERT ON match_event
        BEGIN SELECT RAISE(ABORT, 'forced match write failure'); END;`);
      assert.throws(() => advanceNextFixture(db, 1), /forced match write failure/);
      assert.equal((db.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status, "SCHEDULED");
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=1").get() as {count:number}).count, 0);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM match_momentum WHERE fixture_id=1").get() as {count:number}).count, 0);
      assert.equal((db.prepare("SELECT energy FROM player_condition WHERE player_id=1").get() as {energy:number}).energy, energyBefore);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a full league season completes, survives reopening, and creates next season idempotently", async () => {
  const root = tempRoot();
  try {
    const { manager, save } = await createSave(root);
    let db = manager.open(save.filePath);
    try {
      assert.equal(listFixtures(db).filter(f => f.competition === "Liga Nacional de Teste").length, 12);
      const rounds = db.prepare("SELECT id FROM competition_round WHERE stage_id=1 ORDER BY round_number").all() as Array<{id:number}>;
      assert.equal(rounds.length, 6);
      for (const round of rounds) advanceRound(db, round.id);
      assert.equal(getSeasonStatus(db, 1)[0]?.seasonStatus, "COMPLETED");
      assert.equal(getSeasonStatus(db, 1)[0]?.stageStatus, "COMPLETED");
      const standings = getStandings(db, 1);
      assert.ok(standings.every(row => row.played === 6));
      assert.equal(standings.reduce((sum,row) => sum + row.played, 0), 24);
      db.close();
      db = manager.open(save.filePath);
      assert.equal(getSeasonStatus(db, 1)[0]?.seasonStatus, "COMPLETED");
      const first = prepareNextLeagueSeason(db, 1);
      assert.equal(first.fixtures, 12);
      assert.deepEqual(prepareNextLeagueSeason(db, 1), first);
      assert.equal((db.prepare("SELECT COUNT(*) AS count FROM competition_season WHERE competition_id=1").get() as {count:number}).count, 2);
    } finally {
      if (db.open) db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI smoke test initializes a clean world, creates a save, lists it, and opens fixtures by save id", () => {
  const root = tempRoot();
  const master = join(root, "world", "master.sqlite");
  const saves = join(root, "world", "saves");
  const env = { ...process.env, GMF_MASTER_DB: master, GMF_SAVES_DIR: saves, GMF_SCHEMA_SQL: schemaPath };
  const cliPath = resolve("dist/cli.js");
  const run = (...args: string[]) => spawnSync(process.execPath, [cliPath, ...args], {
    encoding: "utf8", env, cwd: process.cwd(),
  });
  try {
    let result = run("init-master");
    assert.equal(result.status, 0, result.stderr);
    result = run("clubs");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Aurora Futebol Clube/);
    result = run("new-save", "--name", "CLI career", "--manager", "CLI manager", "--club", "1");
    assert.equal(result.status, 0, result.stderr);
    const created = JSON.parse(result.stdout) as {id:string};
    assert.ok(created.id);
    result = run("saves");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(created.id));
    result = run("fixtures", "--save-id", created.id);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Liga Nacional de Teste/);
    result = run("fixtures", "--save-id", created.id, "--save", created.filePath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Use either --save-id or --save/);
    result = run("init-master");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /already exists and is valid/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
