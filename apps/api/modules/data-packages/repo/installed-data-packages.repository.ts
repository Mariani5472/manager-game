import type { SqliteDatabase } from "../../../db/database.js";
import { tableExists } from "../../../db/database.js";
import type { InstalledDataPackage } from "../types/data-package.types.js";

export function listInstalledDataPackages(
  db: SqliteDatabase,
): InstalledDataPackage[] {
  // This is a query service: schema creation belongs to installation/migration flows.
  if (!tableExists(db, "data_package_install")) return [];

  return db
    .prepare(
      `
    SELECT
      package_id AS id,
      version,
      installed_at AS installedAt,
      manifest_json AS dependencies
    FROM data_package_install
    ORDER BY package_id
  `,
    )
    .all() as InstalledDataPackage[];
}
