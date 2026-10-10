import { existsSync, mkdirSync, renameSync, rmSync, statSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { openDatabase, validateDatabase } from "../db/database.js";

export interface CreateSaveOptions {
  masterPath: string;
  savesDirectory: string;
  name: string;
  managerName: string;
  clubId: number;
}
export interface SaveInfo {
  id: string;
  name: string;
  managerName: string;
  clubId: number;
  createdAt: string;
  filePath: string;
}

const CURRENT_SCHEMA_VERSION = 1;
const SAVE_METADATA_TABLE = `
  CREATE TABLE IF NOT EXISTS game_save_metadata (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    manager_name TEXT NOT NULL,
    selected_club_id INTEGER NOT NULL REFERENCES club(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1)
  )
`;

function safeFileName(value: string): string {
  const cleaned = value.normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "campaign";
}

function readSchemaVersion(db: ReturnType<typeof openDatabase>): number {
  const row = db.prepare("SELECT MAX(version) AS version FROM schema_version").get() as { version: number | null };
  if (row.version === null) throw new Error("Database has no applied schema version.");
  if (row.version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Database schema version ${row.version} is newer than this game supports (${CURRENT_SCHEMA_VERSION}).`);
  }
  if (row.version < CURRENT_SCHEMA_VERSION) {
    throw new Error(`Database schema version ${row.version} is too old; expected ${CURRENT_SCHEMA_VERSION}.`);
  }
  return row.version;
}

function removeDatabaseFiles(filePath: string): void {
  rmSync(filePath, { force: true });
  rmSync(`${filePath}-wal`, { force: true });
  rmSync(`${filePath}-shm`, { force: true });
  rmSync(`${filePath}-journal`, { force: true });
}

export class SaveManager {
  constructor(
    private readonly masterPath: string,
    private readonly savesDirectory: string,
  ) {}

  async create(options: Omit<CreateSaveOptions, "masterPath" | "savesDirectory">): Promise<SaveInfo> {
    const master = resolve(this.masterPath);
    if (!existsSync(master)) {
      throw new Error(`Master database not found: ${master}. Run "npm run dev -- init-master" first.`);
    }
    if (statSync(master).size === 0) throw new Error("Master database is empty.");

    const saveName = options.name.trim();
    const managerName = options.managerName.trim();
    if (!saveName) throw new Error("Save name cannot be empty.");
    if (!managerName) throw new Error("Manager name cannot be empty.");
    if (!Number.isSafeInteger(options.clubId) || options.clubId <= 0) {
      throw new Error("Club id must be a positive integer.");
    }

    const saveId = randomUUID();
    const destinationDirectory = resolve(this.savesDirectory);
    mkdirSync(destinationDirectory, { recursive: true });
    const fileName = `${safeFileName(saveName)}-${saveId.slice(0, 8)}.sqlite`;
    const destination = join(destinationDirectory, fileName);
    const temporary = join(destinationDirectory, `.${fileName}.${randomUUID()}.tmp.sqlite`);

    let masterDb: ReturnType<typeof openDatabase> | undefined;
    let saveDb: ReturnType<typeof openDatabase> | undefined;
    try {
      masterDb = openDatabase(master, true);
      validateDatabase(masterDb);
      readSchemaVersion(masterDb);
      const club = masterDb.prepare("SELECT id FROM club WHERE id = ?").get(options.clubId) as { id: number } | undefined;
      if (!club) throw new Error(`Club ${options.clubId} does not exist in master database.`);

      // SQLite's online backup API gives a consistent snapshot even when the master
      // database is running in WAL mode or has recently received writes.
      await masterDb.backup(temporary);
      masterDb.close();
      masterDb = undefined;

      saveDb = openDatabase(temporary);
      saveDb.exec(SAVE_METADATA_TABLE);
      const insertMetadata = saveDb.prepare(`
        INSERT INTO game_save_metadata (id, name, manager_name, selected_club_id, schema_version)
        VALUES (?, ?, ?, ?, ?)
      `);
      const createMetadata = saveDb.transaction(() => {
        insertMetadata.run(saveId, saveName, managerName, options.clubId, CURRENT_SCHEMA_VERSION);
        saveDb!.prepare("UPDATE competition_season SET status = 'ACTIVE' WHERE status = 'PLANNED'").run();
      });
      createMetadata();
      validateDatabase(saveDb);
      readSchemaVersion(saveDb);
      const metadata = saveDb.prepare(`
        SELECT id, name, manager_name AS managerName, selected_club_id AS clubId,
               created_at AS createdAt, schema_version AS schemaVersion
        FROM game_save_metadata WHERE id = ?
      `).get(saveId) as Omit<SaveInfo, "filePath"> & { schemaVersion: number };
      if (metadata.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        throw new Error(`Save schema version ${metadata.schemaVersion} is not supported.`);
      }

      // Make the completed database a single portable file before atomic publication.
      saveDb.pragma("wal_checkpoint(TRUNCATE)");
      saveDb.pragma("journal_mode = DELETE");
      saveDb.close();
      saveDb = undefined;
      renameSync(temporary, destination);
      return {
        id: metadata.id,
        name: metadata.name,
        managerName: metadata.managerName,
        clubId: metadata.clubId,
        createdAt: metadata.createdAt,
        filePath: destination,
      };
    } catch (error) {
      if (saveDb?.open) saveDb.close();
      if (masterDb?.open) masterDb.close();
      removeDatabaseFiles(temporary);
      removeDatabaseFiles(destination);
      throw error;
    }
  }

  open(filePath: string) {
    const db = openDatabase(filePath);
    try {
      validateDatabase(db);
      readSchemaVersion(db);
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_save_metadata'").get()) {
        throw new Error("This database is not a Game Manager campaign save.");
      }
      const metadata = db.prepare("SELECT selected_club_id AS clubId, schema_version AS schemaVersion FROM game_save_metadata LIMIT 1")
        .get() as { clubId: number; schemaVersion: number } | undefined;
      if (!metadata) throw new Error("Campaign save metadata is missing.");
      if (metadata.schemaVersion !== CURRENT_SCHEMA_VERSION) {
        throw new Error(`Save schema version ${metadata.schemaVersion} is not supported.`);
      }
      if (!db.prepare("SELECT 1 FROM club WHERE id=?").get(metadata.clubId)) {
        throw new Error(`Selected club ${metadata.clubId} does not exist in this save.`);
      }
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  openById(saveId: string) {
    const normalizedId = saveId.trim();
    if (!normalizedId) throw new Error("Save id cannot be empty.");
    const matches = this.list().filter(save => save.id === normalizedId);
    if (matches.length === 0) throw new Error(`Campaign save "${normalizedId}" was not found.`);
    if (matches.length > 1) throw new Error(`Multiple saves use id "${normalizedId}".`);
    return this.open(matches[0]!.filePath);
  }

  list(): SaveInfo[] {
    const directory = resolve(this.savesDirectory);
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter(name => name.endsWith(".sqlite"))
      .flatMap(name => {
        const filePath = join(directory, name);
        try {
          const db = openDatabase(filePath, true);
          try {
            if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_save_metadata'").get()) return [];
            const row = db.prepare(`
              SELECT id, name, manager_name AS managerName, selected_club_id AS clubId,
                     created_at AS createdAt
              FROM game_save_metadata LIMIT 1
            `).get() as Omit<SaveInfo, "filePath"> | undefined;
            return row ? [{ ...row, filePath }] : [];
          } finally {
            db.close();
          }
        } catch {
          return [];
        }
      })
      .sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
  }
}
