import { existsSync, mkdirSync, readFileSync } from "node:fs";
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
  const schema = readFileSync(schemaPath, "utf8");
  const db = openDatabase(masterPath);

  try {
    db.exec(schema);
    validateDatabase(db);
    console.log(`Master DB created: ${masterPath}`);
  } catch (error) {
    db.close();
    throw error;
  } finally {
    if (db.open) db.close();
  }
}

function usage(): never {
  console.log(`Game Manager Football CLI

Commands:
  init-master
  clubs
  new-save --name <save-name> --manager <manager-name> --club <club-id>
  saves
  fixtures [--pending] (--save-id <save-id> | --save <path>)
  play [fixture-id] (--save-id <save-id> | --save <path>)
  advance-round <round-id> (--save-id <save-id> | --save <path>)

Environment:
  GMF_MASTER_DB   master database (default: data/master.sqlite)
  GMF_SAVES_DIR   campaign saves (default: data/saves)
  GMF_SCHEMA_SQL  schema SQL path
`);
  process.exit(0);
}

function parseOption(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index < 0) return undefined;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Option ${key} requires a value.`);
  }
  return value;
}

function withSave<T>(args: string[], callback: (db: ReturnType<typeof openDatabase>) => T): T {
  const saveId = parseOption(args, "--save-id");
  const savePath = parseOption(args, "--save");

  if (saveId && savePath) {
    throw new Error("Use either --save-id or --save, not both.");
  }
  if (!saveId && !savePath) {
    throw new Error("Provide --save-id <save-id> (recommended) or --save <path>.");
  }

  const manager = new SaveManager(masterPath, savesDir);
  const db = saveId ? manager.openById(saveId) : manager.open(savePath!);

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
      if (!existsSync(masterPath)) {
        throw new Error(`Master DB not found at ${masterPath}. Run "npm run dev -- init-master" first.`);
      }
      const db = openDatabase(masterPath, true);
      try {
        validateDatabase(db);
        console.table(listClubs(db));
      } finally {
        db.close();
      }
      return;
    }

    case "new-save": {
      const name = parseOption(args, "--name");
      const managerName = parseOption(args, "--manager");
      const clubIdRaw = parseOption(args, "--club");
      if (!name || !managerName || !clubIdRaw) {
        throw new Error("Required: --name, --manager and --club.");
      }

      const clubId = Number(clubIdRaw);
      if (!Number.isSafeInteger(clubId) || clubId <= 0) {
        throw new Error("--club must be a positive integer.");
      }

      const info = new SaveManager(masterPath, savesDir).create({
        name,
        managerName,
        clubId,
      });
      console.log(JSON.stringify(info, null, 2));
      return;
    }

    case "saves":
      console.table(new SaveManager(masterPath, savesDir).list());
      return;

    case "fixtures":
      withSave(args, (db) => console.table(listFixtures(db, args.includes("--pending"))));
      return;

    case "play": {
      const fixtureArg = args.find((arg) => !arg.startsWith("--"));
      const fixtureId = fixtureArg === undefined ? undefined : Number(fixtureArg);
      if (fixtureId !== undefined && (!Number.isSafeInteger(fixtureId) || fixtureId <= 0)) {
        throw new Error("Fixture id must be a positive integer.");
      }
      withSave(args, (db) => console.table([advanceNextFixture(db, fixtureId)]));
      return;
    }

    case "advance-round": {
      const roundArg = args.find((arg) => !arg.startsWith("--"));
      const roundId = Number(roundArg);
      if (!Number.isSafeInteger(roundId) || roundId <= 0) {
        throw new Error("Round id must be a positive integer.");
      }
      withSave(args, (db) => console.table(advanceRound(db, roundId)));
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
