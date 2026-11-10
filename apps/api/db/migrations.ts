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
  {
    version: 4,
    description: "Persist opt-in per-minute momentum diagnostics",
    up(db) {
      db.exec(`
        CREATE TABLE match_momentum_debug (
          fixture_id INTEGER NOT NULL REFERENCES fixture(id) ON DELETE CASCADE,
          minute INTEGER NOT NULL CHECK(minute BETWEEN 1 AND 90),
          trace_json TEXT NOT NULL,
          PRIMARY KEY (fixture_id, minute)
        );
      `);
    },
  },  {
    version: 5,
    description: "Persist immutable match kickoff and full-time history snapshots",
    up(db) {
      db.exec(`
        CREATE TABLE match_history_snapshot (
          fixture_id INTEGER PRIMARY KEY REFERENCES fixture(id) ON DELETE CASCADE,
          home_lineup_json TEXT NOT NULL CHECK (json_valid(home_lineup_json)),
          away_lineup_json TEXT NOT NULL CHECK (json_valid(away_lineup_json)),
          tactics_json TEXT NOT NULL CHECK (json_valid(tactics_json)),
          result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
          engine_version TEXT NOT NULL,
          random_seed INTEGER NOT NULL,
          completed_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CHECK ((result_json IS NULL AND completed_at IS NULL) OR
                 (result_json IS NOT NULL AND completed_at IS NOT NULL))
        );

        CREATE INDEX idx_match_history_completed
          ON match_history_snapshot(completed_at, fixture_id)
          WHERE result_json IS NOT NULL;
      `);
    },
  },

  {
    version: 6,
    description: "Mark reconstructed legacy match history snapshots",
    up(db) {
      db.exec(`ALTER TABLE match_history_snapshot ADD COLUMN is_legacy INTEGER NOT NULL DEFAULT 0 CHECK (is_legacy IN (0,1));`);
    },
  },
];

export const CURRENT_SCHEMA_VERSION = 6;

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
