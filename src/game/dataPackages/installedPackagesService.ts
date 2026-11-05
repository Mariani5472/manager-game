import type { SqliteDatabase } from "../../db/database.js";
import { ensureDataPackageSchema } from "./schema.js";
import type {
  InstalledDataPackage,
} from "./types.js";


export function listInstalledDataPackages(
  db: SqliteDatabase
): InstalledDataPackage[] {
  ensureDataPackageSchema(db);

  return db
    .prepare(`
      SELECT
        package_id AS id,
        version,
        installed_at AS installedAt,
        manifest_json AS dependencies

      FROM data_package_install

      ORDER BY package_id
    `)
    .all() as InstalledDataPackage[];
}