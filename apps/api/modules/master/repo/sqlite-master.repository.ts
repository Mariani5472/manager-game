import { existsSync } from "node:fs";
import { open, validate, type SqliteDatabase } from "../../../db/database.js";
import { masterPath } from "../../../client/config.js";
import { ApplicationError } from "../../../shared/application-error.js";
import type { MasterRepository } from "../master.repository.js";
import type {
  ClubSummaryDto,
  CountryClubsResponse,
  CountrySummaryDto,
} from "../../../shared/src/index.js";

export class SqliteMasterRepository implements MasterRepository {
  private withMaster<T>(query: (db: SqliteDatabase) => T): T {
    if (!existsSync(masterPath)) {
      throw ApplicationError.conflict(
        'Master database is not initialized. Run "npm run dev -- init-master" first.',
        "MASTER_DATABASE_NOT_INITIALIZED",
      );
    }

    const db = open(masterPath, true);
    try {
      validate(db);
      return query(db);
    } finally {
      db.close();
    }
  }

  listCountries(): CountrySummaryDto[] {
    return this.withMaster((db) =>
      db.prepare(`
        SELECT n.id, n.name, n.code, COUNT(c.id) AS clubCount
        FROM nation n
        LEFT JOIN club c ON c.nation_id = n.id
        GROUP BY n.id, n.name, n.code
        ORDER BY n.name
      `).all() as CountrySummaryDto[],
    );
  }

  findCountryClubs(countryId: number): CountryClubsResponse | null {
    return this.withMaster((db) => {
      const country = db.prepare(
        "SELECT id, name, code FROM nation WHERE id = ?",
      ).get(countryId) as CountryClubsResponse["country"] | undefined;

      if (!country) return null;

      const clubs = db.prepare(`
        SELECT c.id, c.name, c.short_name AS shortName, c.reputation,
               ci.name AS city,
               (SELECT stadium.name FROM stadium WHERE stadium.club_id = c.id ORDER BY stadium.id LIMIT 1) AS stadium
        FROM club c
        LEFT JOIN city ci ON ci.id = c.city_id
        WHERE c.nation_id = ?
        ORDER BY c.reputation DESC, c.name
      `).all(countryId) as ClubSummaryDto[];

      return { country, clubs };
    });
  }

  findClubCountryId(clubId: number): number | null {
    return this.withMaster((db) => {
      const row = db.prepare(
        "SELECT nation_id AS countryId FROM club WHERE id = ?",
      ).get(clubId) as { countryId: number } | undefined;
      return row?.countryId ?? null;
    });
  }
}
