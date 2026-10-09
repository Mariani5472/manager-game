import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type SqliteDatabase = InstanceType<typeof Database>;

export function openDatabase(filePath: string, readonly = false): SqliteDatabase {
  const absolutePath = resolve(filePath);
  if (!readonly) mkdirSync(dirname(absolutePath), { recursive: true });

  const db = new Database(absolutePath, { readonly, fileMustExist: readonly });
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  if (!readonly) {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
  }
  return db;
}

export function tableExists(db: SqliteDatabase, tableName: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

export function validateDatabase(db: SqliteDatabase): void {
  const integrity = db.pragma("integrity_check", { simple: true }) as string;
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${integrity}`);

  const foreignKeyErrors = db.pragma("foreign_key_check") as unknown[];
  if (foreignKeyErrors.length > 0) {
    throw new Error(`SQLite foreign-key check failed with ${foreignKeyErrors.length} violation(s)`);
  }

  if (!tableExists(db, "fixture") || !tableExists(db, "club") || !tableExists(db, "schema_version")) {
    throw new Error("Database does not contain the required Game Manager schema");
  }
}
