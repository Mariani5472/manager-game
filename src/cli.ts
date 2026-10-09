import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, validateDatabase } from "./db/database.js";
import { SaveManager } from "./save/saveManager.js";
import { advanceNextFixture, advanceRound, listClubs, listFixtures } from "./game/gameService.js";

const root = process.cwd();
const masterPath = resolve(process.env.GMF_MASTER_DB ?? joinPath(root, "data/master.sqlite"));
const savesDir = resolve(process.env.GMF_SAVES_DIR ?? joinPath(root, "data/saves"));
const schemaPath = resolve(process.env.GMF_SCHEMA_SQL ?? joinPath(root, "src/schema/game_manager_mvp.sql"));

function joinPath(a: string, b: string): string {
  return a.endsWith("/") ? a + b : a + "/" + b;
}

function initializeMaster(): void {
  if (existsSync(masterPath)) {
    console.log(`Master DB already exists: ${masterPath}`);
    return;
  }
  mkdirSync(dirname(masterPath), { recursive: true });
  const schema = (awaitlessReadFile(schemaPath));
  const db = openDatabase(masterPath);
  try {
    db.exec(schema);
    validateDatabase(db);
    console.log(`Master DB created: ${masterPath}`);
  } finally {
    db.close();
  }
}

function awaitlessReadFile(path: string): string {
  // Static Node APIs; kept separate for testability.
  return readText(path);
}
import { readFileSync as readText } from "node:fs";

function usage(): never {
  console.log(`Game Manager Football CLI

Commands:
  init-master
  clubs
  new-save --name <save-name> --manager <manager-name> --club <club-id>
  saves
  fixtures [--pending]
  play [fixture-id]
  advance-round <round-id>

Environment:
  GMF_MASTER_DB   master database (default: data/master.sqlite)
  GMF_SAVES_DIR   campaign saves (default: data/saves)
  GMF_SCHEMA_SQL  schema SQL path
`);
  process.exit(0);
}

function parseOption(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : undefined;
}

function withSave<T>(callback: (db: ReturnType<typeof openDatabase>) => T): T {
  const path = parseOption(process.argv.slice(3), "--save");
  if (!path) throw new Error("Provide --save <path> for a campaign command.");
  const manager = new SaveManager(masterPath, savesDir);
  const db = manager.open(path);
  try {
    return callback(db);
  } finally {
    db.close();
  }
}

function main(): void {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "init-master":
      initializeMaster();
      return;
    case "clubs": {
      const db = openDatabase(masterPath, true);
      try { validateDatabase(db); console.table(listClubs(db)); }
      finally { db.close(); }
      return;
    }
    case "new-save": {
      const name = parseOption(args, "--name");
      const managerName = parseOption(args, "--manager");
      const clubIdRaw = parseOption(args, "--club");
      if (!name || !managerName || !clubIdRaw) throw new Error("Required: --name, --manager and --club.");
      const info = new SaveManager(masterPath, savesDir).create({
        name, managerName, clubId: Number(clubIdRaw),
      });
      console.log(JSON.stringify(info, null, 2));
      return;
    }
    case "saves":
      console.table(new SaveManager(masterPath, savesDir).list());
      return;
    case "fixtures":
      withSave((db) => console.table(listFixtures(db, args.includes("--pending"))));
      return;
    case "play": {
      const fixtureId = args[0] ? Number(args[0]) : undefined;
      withSave((db) => console.table([advanceNextFixture(db, fixtureId)]));
      return;
    }
    case "advance-round": {
      const roundId = Number(args[0]);
      if (!Number.isInteger(roundId) || roundId <= 0) throw new Error("Provide a valid round id.");
      withSave((db) => console.table(advanceRound(db, roundId)));
      return;
    }
    default:
      usage();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
