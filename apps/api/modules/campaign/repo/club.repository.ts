import { SqliteDatabase } from "../../../db/database.js";

export function listClubs(db: SqliteDatabase): Array<{
  id: number;
  name: string;
  nation: string;
}> {
  return db
    .prepare<
      [],
      {
        id: number;
        name: string;
        nation: string;
      }
    >(
      `
      SELECT
        c.id,
        c.name,
        n.name AS nation

      FROM club c

      JOIN nation n
        ON n.id = c.nation_id

      ORDER BY
        c.reputation DESC,
        c.name
    `,
    )
    .all();
}

export interface ClubSummary {
  id: number;
  name: string;
  nation: string;
  isManaged: boolean;
}

export function getManagedClub(db: SqliteDatabase): ClubSummary {
  const metadata = db
    .prepare<
      [],
      {
        clubId: number;
      }
    >(
      `
      SELECT
        selected_club_id AS clubId

      FROM game_save_metadata

      LIMIT 1
    `,
    )
    .get();

  if (!metadata) {
    throw new Error("Campaign metadata is missing.");
  }

  const club = db
    .prepare<number, Omit<ClubSummary, "isManaged">>(
      `
      SELECT
        c.id,
        c.name,
        n.name AS nation

      FROM club c

      JOIN nation n
        ON n.id = c.nation_id

      WHERE c.id = ?
    `,
    )
    .get(metadata.clubId);

  if (!club) {
    throw new Error(
      `Managed club ${metadata.clubId} is missing from this save.`,
    );
  }

  return {
    ...club,
    isManaged: true,
  };
}
