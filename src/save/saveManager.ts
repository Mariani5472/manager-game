import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, readdirSync } from "node:fs";
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
  const cleaned = value
    .normalize("NFKD")
    .replace(/[\\u0300-\\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "campaign";
}

export class SaveManager {
  constructor(
    private readonly masterPath: string,
    private readonly savesDirectory: string,
  ) {}

  create(options: Omit<CreateSaveOptions, "masterPath" | "savesDirectory">): SaveInfo {
    const master = resolve(this.masterPath);
    if (!existsSync(master)) {
      throw new Error(`Master database not found: ${master}. Create it by executing src/schema/game_manager_mvp.sql first.`);
    }
    if (statSync(master).size === 0) throw new Error("Master database is empty.");

    const db = openDatabase(master, true);
    try {
      validateDatabase(db);
      const club = db.prepare("SELECT id FROM club WHERE id = ?").get(options.clubId) as { id: number } | undefined;
      if (!club) throw new Error(`Club ${options.clubId} does not exist in master database.`);
    } finally {
      db.close();
    }

    const saveId = randomUUID();
    const saveName = options.name.trim();
    const managerName = options.managerName.trim();
    if (!saveName) throw new Error("Save name cannot be empty.");
    if (!managerName) throw new Error("Manager name cannot be empty.");

    const destinationDirectory = resolve(this.savesDirectory);
    mkdirSync(destinationDirectory, { recursive: true });
    const fileName = `${safeFileName(saveName)}-${saveId.slice(0, 8)}.sqlite`;
    const destination = join(destinationDirectory, fileName);
    const temporary = join(destinationDirectory, `.${fileName}.tmp`);

    try {
      // SQLite's backup API would be ideal for a live master DB, but a freshly initialized,
      // immutable master is copied while no process should be writing to it.
      copyFileSync(master, temporary);
      renameSync(temporary, destination);

      const saveDb = openDatabase(destination);
      try {
        saveDb.exec(SAVE_METADATA_TABLE);
        saveDb.prepare("INSERT OR IGNORE INTO schema_version (version, description) VALUES (1, ?)").run("Initial Game Manager schema");
        const insertMetadata = saveDb.prepare(`
          INSERT INTO game_save_metadata (id, name, manager_name, selected_club_id, schema_version)
          VALUES (?, ?, ?, ?, 1)
        `);
        const tx = saveDb.transaction(() => {
          insertMetadata.run(saveId, saveName, managerName, options.clubId);
          saveDb.prepare("UPDATE competition_season SET status = 'ACTIVE' WHERE status = 'PLANNED'").run();
        });
        tx();
        validateDatabase(saveDb);
        const metadata = saveDb.prepare(`
          SELECT id, name, manager_name AS managerName, selected_club_id AS clubId,
                 created_at AS createdAt
          FROM game_save_metadata WHERE id = ?
        `).get(saveId) as Omit<SaveInfo, "filePath">;
        return { ...metadata, filePath: destination };
      } finally {
        saveDb.close();
      }
    } catch (error) {
      rmSync(temporary, { force: true });
      rmSync(destination, { force: true });
      throw error;
    }
  }

  open(filePath: string) {
    const db = openDatabase(filePath);
    try {
      validateDatabase(db);
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='game_save_metadata'").get()) {
        throw new Error("This database is not a Game Manager campaign save.");
      }
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  list(): SaveInfo[] {
    const directory = resolve(this.savesDirectory);
    if (!existsSync(directory)) return [];
    // Use explicit file lookup from the directory, opening each save read-only.
    return readdirSync(directory)
      .filter((name) => name.endsWith(".sqlite"))
      .flatMap((name) => {
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
      });
  }
}

