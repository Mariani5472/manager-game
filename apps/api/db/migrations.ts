import type { SqliteDatabase } from "./database.js";

interface Migration {
  version: number;
  description: string;
  up: (db: SqliteDatabase) => void;
}

const migrations: Migration[] = [
  {
    version: 2,
    description: "Persist match preparation and completion metadata",
    up(db) {
      db.exec(`
        ALTER TABLE fixture ADD COLUMN completed_at TEXT;

        UPDATE fixture
        SET completed_at = COALESCE(scheduled_at, CURRENT_TIMESTAMP)
        WHERE status = 'COMPLETED' AND completed_at IS NULL;

        CREATE TABLE match_preparation (
          fixture_id INTEGER PRIMARY KEY REFERENCES fixture(id) ON DELETE CASCADE,
          prepared_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_fixture_round_status_schedule
          ON fixture(round_id, status, scheduled_at, id);

        CREATE INDEX idx_match_event_fixture_timeline
          ON match_event(fixture_id, minute, id);

        CREATE INDEX idx_match_lineup_fixture_club_starting
          ON match_lineup(fixture_id, club_id, is_starting, slot_number);

        CREATE INDEX idx_match_tactical_change_pending
          ON match_tactical_change(fixture_id, applied, minute, id);
      `);
    },
  },
  {
    version: 3,
    description: "Persist per-team match game state for momentum playback",
    up(db) {
      db.exec(`
        ALTER TABLE match_momentum ADD COLUMN home_territorial_control REAL NOT NULL DEFAULT 50;
        ALTER TABLE match_momentum ADD COLUMN away_territorial_control REAL NOT NULL DEFAULT 50;
        ALTER TABLE match_momentum ADD COLUMN home_offensive_threat REAL NOT NULL DEFAULT 25;
        ALTER TABLE match_momentum ADD COLUMN away_offensive_threat REAL NOT NULL DEFAULT 25;
        ALTER TABLE match_momentum ADD COLUMN home_defensive_stability REAL NOT NULL DEFAULT 50;
        ALTER TABLE match_momentum ADD COLUMN away_defensive_stability REAL NOT NULL DEFAULT 50;
        ALTER TABLE match_momentum ADD COLUMN home_intensity REAL NOT NULL DEFAULT 50;
        ALTER TABLE match_momentum ADD COLUMN away_intensity REAL NOT NULL DEFAULT 50;
        ALTER TABLE match_momentum ADD COLUMN home_physical_condition REAL NOT NULL DEFAULT 100;
        ALTER TABLE match_momentum ADD COLUMN away_physical_condition REAL NOT NULL DEFAULT 100;
      `);
    },
  },
];

export const CURRENT_SCHEMA_VERSION = 3;

export function applyMigrations(db: SqliteDatabase): number {
  const versionTable = db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_version'",
  ).get();

  if (!versionTable) {
    throw new Error("Cannot migrate a database without schema_version.");
  }

  // Read the version after acquiring SQLite's write lock. This prevents two
  // processes opening the same legacy save from attempting the same ALTER TABLE.
  const migrate = db.transaction(() => {
    let currentVersion = (db.prepare(
      "SELECT MAX(version) AS version FROM schema_version",
    ).get() as { version: number | null }).version;

    if (currentVersion === null) {
      throw new Error("Database has no applied schema version.");
    }

    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${currentVersion} is newer than this game supports (${CURRENT_SCHEMA_VERSION}).`,
      );
    }

    for (const migration of migrations) {
      if (migration.version <= currentVersion) continue;

      migration.up(db);
      db.prepare(
        "INSERT INTO schema_version(version, description) VALUES(?, ?)",
      ).run(migration.version, migration.description);
      currentVersion = migration.version;
    }

    if (currentVersion !== CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `Database schema version ${currentVersion} is not supported; expected ${CURRENT_SCHEMA_VERSION}.`,
      );
    }

    return currentVersion;
  });

  return migrate.immediate();
}
