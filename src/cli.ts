import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, validateDatabase } from "./db/database.js";
import { SaveManager } from "./save/saveManager.js";
import {
  advanceNextFixture, advanceRound, getManagedClub, getSeasonStatus, getStandings,
  listClubs, listFixtures, listSquad, getTactics, prepareNextLeagueSeason,
} from "./game/gameService.js";

const root = process.cwd();
const masterPath = resolve(process.env.GMF_MASTER_DB ?? joinPath(root, "data/master.sqlite"));
const savesDir = resolve(process.env.GMF_SAVES_DIR ?? joinPath(root, "data/saves"));
const schemaPath = resolve(process.env.GMF_SCHEMA_SQL ?? joinPath(root, "src/schema/game_manager_mvp.sql"));
function joinPath(a: string, b: string): string { return a.endsWith("/") ? a + b : a + "/" + b; }

function initializeMaster(): void {
  if (existsSync(masterPath)) {
    const existing = openDatabase(masterPath, true);
    try {
      validateDatabase(existing);
      console.log(`Master DB already exists and is valid: ${masterPath}`);
    } finally { existing.close(); }
    return;
  }
  mkdirSync(dirname(masterPath), { recursive: true });
  const db = openDatabase(masterPath);
  try {
    db.exec(readFileSync(schemaPath, "utf8"));
    validateDatabase(db);
    console.log(`Master DB created: ${masterPath}`);
  } catch (error) {
    db.close();
    throw error;
  } finally {
    if (db.open) db.close();
  }
}

function parseOption(args: string[], key: string): string | undefined {
  const index = args.indexOf(key);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Option ${key} requires a value.`);
  return value;
}

function withSave<T>(args: string[], callback: (db: ReturnType<typeof openDatabase>) => T): T {
  const saveId = parseOption(args, "--save-id");
  const savePath = parseOption(args, "--save");
  if (saveId && savePath) throw new Error("Use either --save-id or --save, not both.");
  if (!saveId && !savePath) throw new Error("Provide --save-id <save-id> or --save <path>.");
  const manager = new SaveManager(masterPath, savesDir);
  const db = saveId ? manager.openById(saveId) : manager.open(savePath!);
  try { return callback(db); } finally { db.close(); }
}

function parsePositiveId(raw: string | undefined, label: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer.`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "init-master": initializeMaster(); return;
    case "clubs": {
      if (!existsSync(masterPath)) throw new Error('Run "npm run dev -- init-master" first.');
      const db = openDatabase(masterPath, true);
      try { validateDatabase(db); console.table(listClubs(db)); } finally { db.close(); }
      return;
    }
    case "new-save": {
      const name = parseOption(args, "--name");
      const managerName = parseOption(args, "--manager");
      const clubId = parsePositiveId(parseOption(args, "--club"), "--club");
      if (!name || !managerName) throw new Error("Required: --name, --manager and --club.");
      console.log(JSON.stringify(await new SaveManager(masterPath, savesDir).create({ name, managerName, clubId }), null, 2));
      return;
    }
    case "saves": console.table(new SaveManager(masterPath, savesDir).list()); return;
    case "club": withSave(args, db => console.table([getManagedClub(db)])); return;
    case "squad": withSave(args, db => {
      const rawClubId = parseOption(args, "--club");
      const clubId = rawClubId === undefined ? getManagedClub(db).id : parsePositiveId(rawClubId, "--club");
      console.table(listSquad(db, clubId));
    }); return;
    case "tactics": withSave(args, db => {
      const rawClubId = parseOption(args, "--club");
      const clubId = rawClubId === undefined ? getManagedClub(db).id : parsePositiveId(rawClubId, "--club");
      console.table([getTactics(db, clubId)]);
    }); return;
    case "fixtures": withSave(args, db => console.table(listFixtures(db, args.includes("--pending")))); return;
    case "standings": withSave(args, db => console.table(getStandings(db, parsePositiveId(parseOption(args, "--stage") ?? "1", "--stage")))); return;
    case "season-status": withSave(args, db => console.table(getSeasonStatus(db))); return;
    case "play": {
      const rawId = args.find(value => !value.startsWith("--"));
      const fixtureId = rawId === undefined ? undefined : parsePositiveId(rawId, "Fixture ID");
      withSave(args, db => console.table([advanceNextFixture(db, fixtureId)]));
      return;
    }
    case "advance-round": {
      const rawId = args.find(value => !value.startsWith("--"));
      const roundId = parsePositiveId(rawId, "Round ID");
      withSave(args, db => console.table(advanceRound(db, roundId)));
      return;
    }
    case "next-season": {
      const stageId = parsePositiveId(parseOption(args, "--stage") ?? "1", "--stage");
      withSave(args, db => console.table([prepareNextLeagueSeason(db, stageId)]));
      return;
    }
    default:
      console.log("Commands: init-master, clubs, new-save, saves, club, squad, tactics, fixtures, play, advance-round, standings, season-status, next-season");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
