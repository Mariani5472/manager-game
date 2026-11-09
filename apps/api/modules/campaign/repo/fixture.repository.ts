import { SqliteDatabase } from "../../../db/database.js";


export interface FixtureInfo {
  id: number;
  competition: string;
  stage: string;
  round: string;
  scheduledAt: string | null;
  homeClub: string;
  awayClub: string;
  status: string;
  score: string | null;
  winnerClub: string | null;
}


export function listFixtures(
  db: SqliteDatabase,
  pendingOnly = false
): FixtureInfo[] {
  const statusFilter =
    pendingOnly
      ? "WHERE f.status = 'SCHEDULED'"
      : "";


  return db
    .prepare(`
      SELECT
        f.id,
        co.name AS competition,
        st.name AS stage,
        r.name AS round,
        f.scheduled_at AS scheduledAt,
        home.name AS homeClub,
        away.name AS awayClub,
        f.status,

        CASE
          WHEN f.home_score IS NULL
            OR f.away_score IS NULL
            THEN NULL

          WHEN f.home_score = f.away_score
            AND f.home_penalties IS NOT NULL
            AND f.away_penalties IS NOT NULL
            THEN
              f.home_score ||
              ' - ' ||
              f.away_score ||
              ' (Pênaltis ' ||
              f.home_penalties ||
              ' - ' ||
              f.away_penalties ||
              ')'

          ELSE
            f.home_score ||
            ' - ' ||
            f.away_score
        END AS score,

        CASE
          WHEN f.home_score IS NULL
            OR f.away_score IS NULL
            THEN NULL

          WHEN f.home_score > f.away_score
            THEN home.name

          WHEN f.away_score > f.home_score
            THEN away.name

          WHEN f.home_penalties > f.away_penalties
            THEN home.name

          WHEN f.away_penalties > f.home_penalties
            THEN away.name

          ELSE NULL
        END AS winnerClub

      FROM fixture f

      JOIN competition_round r
        ON r.id = f.round_id

      JOIN competition_stage st
        ON st.id = r.stage_id

      JOIN competition_season cs
        ON cs.id = st.season_id

      JOIN competition co
        ON co.id = cs.competition_id

      JOIN club home
        ON home.id = f.home_club_id

      JOIN club away
        ON away.id = f.away_club_id

      ${statusFilter}

      ORDER BY
        f.scheduled_at,
        f.id
    `)
    .all() as FixtureInfo[];
}
