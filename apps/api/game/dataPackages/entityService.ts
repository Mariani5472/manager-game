import type { SqliteDatabase } from "../../db/database.js";
import type {
  DataPackage,
  EntityType,
} from "./types.js";
import { assert } from "./validationUtils.js";


export function entityKey(
  type: EntityType,
  externalId: string
): string {
  return `${type}:${externalId}`;
}


export function packageInstalledVersion(
  db: SqliteDatabase,
  id: string
): string | undefined {
  const row = db
    .prepare(
      "SELECT version FROM data_package_install WHERE package_id=?"
    )
    .get(id) as {
      version: string;
    } | undefined;

  return row?.version;
}


export function lookupEntity(
  db: SqliteDatabase,
  type: EntityType,
  externalId: string,
  packageId?: string
): number | undefined {
  if (packageId) {
    const row = db
      .prepare(`
        SELECT local_id

        FROM data_package_entity

        WHERE package_id = ?
          AND entity_type = ?
          AND external_id = ?
      `)
      .get(
        packageId,
        type,
        externalId
      ) as {
        local_id: number;
      } | undefined;

    return row?.local_id;
  }


  const rows = db
    .prepare(`
      SELECT local_id

      FROM data_package_entity

      WHERE entity_type = ?
        AND external_id = ?
    `)
    .all(
      type,
      externalId
    ) as Array<{
      local_id: number;
    }>;


  const ids = [
    ...new Set(
      rows.map(row => row.local_id)
    ),
  ];


  if (ids.length > 1) {
    throw new Error(
      `Ambiguous reference ${type} "${externalId}"; ` +
        "use a package dependency that owns the entity."
    );
  }

  if (ids[0] !== undefined) {
    return ids[0];
  }


  if (type === "nation") {
    return (
      db
        .prepare(
          "SELECT id FROM nation WHERE code=?"
        )
        .get(externalId) as {
          id: number;
        } | undefined
    )?.id;
  }

  if (type === "club") {
    return (
      db
        .prepare(
          "SELECT id FROM club WHERE short_name=?"
        )
        .get(externalId) as {
          id: number;
        } | undefined
    )?.id;
  }

  if (type === "competition") {
    return (
      db
        .prepare(
          "SELECT id FROM competition WHERE code=?"
        )
        .get(externalId) as {
          id: number;
        } | undefined
    )?.id;
  }


  return undefined;
}


export function recordEntity(
  db: SqliteDatabase,
  pkg: DataPackage,
  type: EntityType,
  externalId: string,
  localId: number
): void {
  db
    .prepare(`
      INSERT INTO data_package_entity (
        package_id,
        entity_type,
        external_id,
        local_id
      )
      VALUES (?, ?, ?, ?)

      ON CONFLICT (
        package_id,
        entity_type,
        external_id
      )
      DO UPDATE SET
        local_id = excluded.local_id
    `)
    .run(
      pkg.id,
      type,
      externalId,
      localId
    );
}


export function localRef(
  db: SqliteDatabase,
  pkg: DataPackage,
  type: EntityType,
  externalId: string,
  localCodes: Map<string, number>
): number {
  const local =
    localCodes.get(
      entityKey(type, externalId)
    ) ??
    lookupEntity(
      db,
      type,
      externalId
    );

  assert(
    local !== undefined,
    `Unresolved reference ${type} "${externalId}". ` +
      "Include it in this package or declare its owning package " +
      "as a dependency."
  );

  return local;
}