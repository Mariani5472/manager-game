import type { SqliteDatabase } from "../../../db/database.js";

export function ensureDataPackageSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_package_install (
      package_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS data_package_entity (
      package_id TEXT NOT NULL
        REFERENCES data_package_install(package_id)
        ON DELETE CASCADE,

      entity_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      local_id INTEGER NOT NULL,

      PRIMARY KEY (
        package_id,
        entity_type,
        external_id
      )
    );

    CREATE TABLE IF NOT EXISTS data_package_competition_tier (
      competition_id INTEGER PRIMARY KEY
        REFERENCES competition(id)
        ON DELETE CASCADE,

      tier INTEGER NOT NULL CHECK (tier > 0),
      package_id TEXT NOT NULL
    );
  `);
}
