import { existsSync } from "node:fs";
import { masterPath } from "../../../client/config.js";
import { open, tableExists, validate } from "../../../db/database.js";
import { ApplicationError } from "../../../shared/application-error.js";
import { listInstalledDataPackages } from "./installed-data-packages.repository.js";
import type { DataPackageSummaryDto } from "../../../../shared/src/index.js";
import type { DataPackageRepository } from "../data-package.repository.js";

export class SqliteDataPackageRepository implements DataPackageRepository {
  listInstalled(): DataPackageSummaryDto[] {
    if (!existsSync(masterPath)) {
      throw ApplicationError.conflict(
        'Master database is not initialized. Run "npm run dev -- init-master" first.',
        "MASTER_DATABASE_NOT_INITIALIZED",
      );
    }

    const db = open(masterPath, true);
    try {
      validate(db);
      if (!tableExists(db, "data_package_install")) return [];

      return listInstalledDataPackages(db).map((item) => {
        let dependencies: DataPackageSummaryDto["dependencies"] = [];
        try {
          const manifest = JSON.parse(item.dependencies) as {
            dependencies?: DataPackageSummaryDto["dependencies"];
          };
          dependencies = manifest.dependencies ?? [];
        } catch {
          // Keep legacy metadata visible without failing the entire package list.
        }

        return {
          id: item.id,
          version: item.version,
          installedAt: item.installedAt,
          dependencies,
        };
      });
    } finally {
      db.close();
    }
  }
}
