import { SqliteDatabase } from "../../../db/database.js";


interface StageRow {
  stage_id: number;
  season_id: number;
  competition_id: number;
  competition: string;
  season_year: number;
  season_status: string;
  stage: string;
  stage_kind: string;
}


export function getStage(
  db: SqliteDatabase,
  stageId: number
): StageRow {
  const row = db
    .prepare<number, StageRow>(`
      SELECT
        st.id AS stage_id,
        st.season_id,
        cs.competition_id,
        co.name AS competition,
        cs.season_year,
        cs.status AS season_status,
        st.name AS stage,
        st.stage_kind

      FROM competition_stage st

      JOIN competition_season cs
        ON cs.id = st.season_id

      JOIN competition co
        ON co.id = cs.competition_id

      WHERE st.id = ?
    `)
    .get(stageId);

  if (!row) {
    throw new Error(`Stage ${stageId} was not found.`);
  }

  return row;
}


export interface SeasonSummary {
  seasonId: number;
  competition: string;
  seasonYear: number;
  seasonStatus: string;
  stageId: number;
  stage: string;
  stageKind: string;
  stageStatus: "IN_PROGRESS" | "COMPLETED";
  pendingFixtures: number;
  completedFixtures: number;
}


export function getSeasonStatus(
  db: SqliteDatabase,
  stageId?: number
): SeasonSummary[] {
  const query = `
    SELECT
      st.id AS stage_id,
      st.season_id,
      cs.competition_id,
      co.name AS competition,
      cs.season_year,
      cs.status AS season_status,
      st.name AS stage,
      st.stage_kind

    FROM competition_stage st

    JOIN competition_season cs
      ON cs.id = st.season_id

    JOIN competition co
      ON co.id = cs.competition_id

    ${stageId === undefined ? "" : "WHERE st.id = ?"}

    ORDER BY
      cs.season_year,
      co.name,
      st.stage_order
  `;

  const stages = (
    stageId === undefined
      ? db.prepare<[], StageRow>(query).all()
      : db.prepare<number, StageRow>(query).all(stageId)
  );


  return stages.map(stage => {
    const counts = db
      .prepare<
        number,
        {
          completed: number | null;
          pending: number | null;
        }
      >(`
        SELECT
          SUM(
            CASE
              WHEN status = 'COMPLETED' THEN 1
              ELSE 0
            END
          ) AS completed,

          SUM(
            CASE
              WHEN status IN (
                'SCHEDULED',
                'IN_PROGRESS',
                'POSTPONED'
              ) THEN 1
              ELSE 0
            END
          ) AS pending

        FROM fixture f

        JOIN competition_round r
          ON r.id = f.round_id

        WHERE r.stage_id = ?
      `)
      .get(stage.stage_id);


    const completed = counts?.completed ?? 0;
    const pending = counts?.pending ?? 0;

    let knockoutFinalComplete = true;


    if (stage.stage_kind === "KNOCKOUT") {
      const finalRound = db
        .prepare<
          [number, number],
          {
            total: number;
            completed: number | null;
            decided: number | null;
          }
        >(`
          SELECT
            COUNT(f.id) AS total,

            SUM(
              CASE
                WHEN f.status = 'COMPLETED' THEN 1
                ELSE 0
              END
            ) AS completed,

            SUM(
              CASE
                WHEN f.home_score <> f.away_score
                  THEN 1

                WHEN f.home_score = f.away_score
                  AND f.home_penalties IS NOT NULL
                  AND f.away_penalties IS NOT NULL
                  AND f.home_penalties <> f.away_penalties
                  THEN 1

                ELSE 0
              END
            ) AS decided

          FROM competition_round r

          LEFT JOIN fixture f
            ON f.round_id = r.id

          WHERE r.stage_id = ?
            AND r.round_number = (
              SELECT MAX(round_number)
              FROM competition_round
              WHERE stage_id = ?
            )
        `)
        .get(stage.stage_id, stage.stage_id);


      knockoutFinalComplete =
        finalRound?.total === 1 &&
        (finalRound.completed ?? 0) === 1 &&
        (finalRound.decided ?? 0) === 1;
    }


    const stageComplete =
      pending === 0 &&
      completed > 0 &&
      (
        stage.stage_kind !== "KNOCKOUT" ||
        knockoutFinalComplete
      );


    return {
      seasonId: stage.season_id,
      competition: stage.competition,
      seasonYear: stage.season_year,
      seasonStatus: stage.season_status,

      stageId: stage.stage_id,
      stage: stage.stage,
      stageKind: stage.stage_kind,
      stageStatus: stageComplete
        ? "COMPLETED"
        : "IN_PROGRESS",

      pendingFixtures: pending,
      completedFixtures: completed,
    };
  });
}