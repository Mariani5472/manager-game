import { SqliteDatabase } from "../../../db/database.js";
export interface FactoryCalendarRepair {
  repaired: boolean;
  rounds: number;
  fixtures: number;
}
/**
 * Assign deterministic, position-aware factory squad profiles once per database.
 * Existing saves remain independent; only a save explicitly passed through this
 * factory initializer is profiled. Re-running initialization is idempotent.
 */
export function ensureFactorySquadProfiles(
  db: SqliteDatabase
): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS factory_balance_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      profile_version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);


  const current = db
    .prepare(
      "SELECT profile_version FROM factory_balance_metadata WHERE id=1"
    )
    .get() as {
      profile_version: number;
    } | undefined;


  if (current?.profile_version === 1) {
    return;
  }


  const clubs = db
    .prepare(`
      SELECT
        id,
        reputation

      FROM club

      ORDER BY
        reputation DESC,
        id
    `)
    .all() as Array<{
      id: number;
      reputation: number;
    }>;


  if (clubs.length !== 16) {
    throw new Error(
      "Squad recalibration requires a 16-club factory world."
    );
  }


  const tiers = new Map<number, number>();


  clubs.forEach((club, index) => {
    // 3 elite, 4 competitive, 5 mid-table, 4 lower-table clubs.
    const tier =
      index < 3
        ? 0
        : index < 7
          ? 1
          : index < 12
            ? 2
            : 3;

    tiers.set(
      club.id,
      tier
    );
  });


  const attrs = [
    "pace",
    "acceleration",
    "stamina",
    "strength",
    "agility",
    "positioning",
    "anticipation",
    "decisions",
    "composure",
    "teamwork",
    "work_rate",
    "passing",
    "vision",
    "crossing",
    "dribbling",
    "finishing",
    "long_shots",
    "heading",
    "tackling",
    "marking",
    "aggression",
    "concentration",
    "reflexes",
    "handling",
    "aerial_reach",
  ];


  const selectPlayers = db.prepare(`
    SELECT
      p.person_id AS id,
      p.goalkeeper,
      sm.shirt_number AS shirtNumber,

      (
        SELECT pp.position_code

        FROM player_position pp

        WHERE pp.player_id = p.person_id

        ORDER BY
          pp.rating DESC,
          pp.position_code

        LIMIT 1
      ) AS position

    FROM squad_membership sm

    JOIN player p
      ON p.person_id = sm.player_id

    WHERE sm.club_id = ?

    ORDER BY
      sm.shirt_number,
      p.person_id
  `);


  const updateAttrs = db.prepare(
    "UPDATE player_attribute SET " +
    attrs
      .map(attribute => attribute + "=?")
      .join(",") +
    " WHERE player_id=?"
  );

  const updatePosition = db.prepare(
    "UPDATE player_position SET rating=? WHERE player_id=? AND position_code=?"
  );

  const updateClub = db.prepare(
    "UPDATE club SET reputation=? WHERE id=?"
  );


  const update = db.transaction(() => {
    for (const club of clubs) {
      const tier = tiers.get(club.id)!;
      const base = [73, 66, 59, 52][tier]!;
      const identity = (club.id * 17) % 3;


      const players = selectPlayers.all(
        club.id
      ) as Array<{
        id: number;
        goalkeeper: number;
        shirtNumber: number | null;
        position: string | null;
      }>;


      for (const player of players) {
        const role =
          player.position ??
          (
            player.goalkeeper
              ? "GK"
              : "CM"
          );

        const isBench =
          (player.shirtNumber ?? 99) > 11;

        const benchPenalty =
          isBench
            ? 5 + ((player.id + club.id) % 4)
            : 0;


        const roleBonus: Record<
          string,
          Partial<Record<string, number>>
        > = {
          GK: {
            reflexes: 9,
            handling: 8,
            aerial_reach: 7,
            positioning: 5,
            concentration: 5,
            pace: -13,
            finishing: -16,
          },

          CB: {
            tackling: 8,
            marking: 9,
            strength: 6,
            heading: 6,
            pace: -2,
            finishing: -12,
          },

          LB: {
            tackling: 4,
            marking: 4,
            pace: 5,
            stamina: 5,
            crossing: 5,
            finishing: -6,
          },

          RB: {
            tackling: 4,
            marking: 4,
            pace: 5,
            stamina: 5,
            crossing: 5,
            finishing: -6,
          },

          LWB: {
            pace: 6,
            stamina: 6,
            crossing: 6,
            tackling: 3,
            marking: 2,
          },

          RWB: {
            pace: 6,
            stamina: 6,
            crossing: 6,
            tackling: 3,
            marking: 2,
          },

          DM: {
            tackling: 5,
            marking: 4,
            positioning: 5,
            passing: 3,
            work_rate: 5,
            finishing: -7,
          },

          CM: {
            passing: 5,
            vision: 5,
            decisions: 4,
            teamwork: 5,
            stamina: 3,
          },

          AM: {
            vision: 7,
            passing: 5,
            dribbling: 5,
            composure: 4,
            finishing: 3,
            tackling: -5,
          },

          LW: {
            pace: 8,
            dribbling: 7,
            crossing: 5,
            finishing: 3,
            tackling: -7,
            marking: -6,
          },

          RW: {
            pace: 8,
            dribbling: 7,
            crossing: 5,
            finishing: 3,
            tackling: -7,
            marking: -6,
          },

          LM: {
            pace: 6,
            dribbling: 5,
            crossing: 6,
            stamina: 4,
            tackling: -4,
          },

          RM: {
            pace: 6,
            dribbling: 5,
            crossing: 6,
            stamina: 4,
            tackling: -4,
          },

          ST: {
            finishing: 9,
            composure: 6,
            positioning: 7,
            heading: 4,
            tackling: -11,
            marking: -10,
          },
        };


        const bonuses = roleBonus[role] ?? {};

        const specialization: Record<string, number> = {};


        if (
          identity === 0 &&
          ["ST", "LW", "RW", "AM"].includes(role)
        ) {
          specialization.finishing = 4;
          specialization.dribbling = 3;
          specialization.vision = 2;
        } else if (
          identity === 1 &&
          ["GK", "CB", "LB", "RB", "DM"].includes(role)
        ) {
          specialization.tackling = 3;
          specialization.marking = 3;
          specialization.concentration = 3;

          specialization.reflexes =
            role === "GK"
              ? 4
              : 0;
        } else if (
          identity === 2 &&
          ["CM", "DM", "AM", "LW", "RW"].includes(role)
        ) {
          specialization.passing = 3;
          specialization.vision = 3;
          specialization.stamina = 2;
        }


        const values = attrs.map((attribute, i) => {
          const deterministicNoise =
            (
              player.id * 13 +
              club.id * 7 +
              i * 5
            ) % 9 - 4;

          const value =
            base +
            (bonuses[attribute] ?? 0) +
            (specialization[attribute] ?? 0) -
            benchPenalty +
            deterministicNoise;

          return Math.max(
            28,
            Math.min(
              94,
              Math.round(value)
            )
          );
        });


        updateAttrs.run(
          ...values,
          player.id
        );


        const positionRating = Math.max(
          35,
          Math.min(
            94,
            base +
            (
              role === "GK"
                ? 4
                : 0
            ) +
            (
              isBench
                ? -5
                : 3
            ) +
            ((player.id * 11 + club.id) % 7) -
            3
          )
        );


        if (player.position) {
          updatePosition.run(
            positionRating,
            player.id,
            player.position
          );
        }
      }


      // Reputation communicates expected club stature, but is not used as a match bonus.
      const reputation = Math.max(
        25,
        Math.min(
          92,
          base +
          15 +
          ((club.id * 3) % 5) -
          2
        )
      );


      updateClub.run(
        reputation,
        club.id
      );
    }


    db
      .prepare(`
        INSERT INTO factory_balance_metadata (
          id,
          profile_version
        )
        VALUES (1, 1)

        ON CONFLICT(id)
        DO UPDATE SET
          profile_version = excluded.profile_version,
          applied_at = CURRENT_TIMESTAMP
      `)
      .run();
  });


  update();
}