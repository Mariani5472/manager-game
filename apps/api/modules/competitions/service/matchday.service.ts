import { SqliteDatabase } from "../../../db/database.js";
import { advanceRoundById } from "./calendar.service.js";
import { progressKnockoutStage } from "./knockout.service.js";
import { finishSeasonIfComplete } from "./season.service.js";
import { rebuildStandings } from "../repo/standings.repository.js";
import { MatchSummary, simulateMatch } from "../../matches/service/match-simulation.service.js";


export function advanceNextFixture(
  db: SqliteDatabase,
  fixtureId?: number
): MatchSummary {
  const row = fixtureId
    ? db
        .prepare(`
          SELECT id

          FROM fixture

          WHERE id = ?
            AND status IN (
              'SCHEDULED',
              'IN_PROGRESS'
            )
        `)
        .get(fixtureId) as {
          id: number;
        } | undefined

    : db
        .prepare(`
          SELECT id

          FROM fixture

          WHERE status IN (
            'SCHEDULED',
            'IN_PROGRESS'
          )

          ORDER BY
            CASE status
              WHEN 'IN_PROGRESS' THEN 0
              ELSE 1
            END,
            scheduled_at,
            id

          LIMIT 1
        `)
        .get() as {
          id: number;
        } | undefined;


  if (!row) {
    throw new Error(
      fixtureId
        ? `Scheduled fixture ${fixtureId} not found (it may already be completed or is not playable).`
        : "No scheduled or in-progress fixtures remain."
    );
  }


  const stage = db
    .prepare(`
      SELECT
        r.stage_id AS id,
        r.id AS roundId

      FROM fixture f

      JOIN competition_round r
        ON r.id = f.round_id

      WHERE f.id = ?
    `)
    .get(row.id) as {
      id: number;
      roundId: number;
    } | undefined;


  if (!stage) {
    throw new Error(
      `Fixture ${row.id} has no competition stage.`
    );
  }


  // simulateMatch commits a checkpoint after every minute. Do not wrap it in an
  // outer transaction, otherwise SQLite would defer every checkpoint until FT.
  const summary = simulateMatch(
    db,
    row.id
  );


  const finalizeMatchday = db.transaction(() => {
    progressKnockoutStage(
      db,
      stage.id,
      stage.roundId
    );

    rebuildStandings(
      db,
      stage.id
    );

    finishSeasonIfComplete(
      db,
      stage.id
    );
  });

  // Match checkpoints are committed independently; post-match competition
  // bookkeeping is atomic and can be safely retried after a process restart.
  finalizeMatchday.immediate();


  return summary;
}


/**
 * Simulate every pending fixture in the round containing the managed club's
 * next match. Passing a fixture ID uses that fixture to choose the round.
 * Completed fixtures are preserved, and each pending match is simulated once.
 */
export function advanceFixtureRound(
  db: SqliteDatabase,
  fixtureId?: number
): MatchSummary[] {
  let selected: {
    id: number;
  } | undefined;


  if (fixtureId !== undefined) {
    selected = db
      .prepare(`
        SELECT id

        FROM fixture

        WHERE id = ?
          AND status IN (
            'SCHEDULED',
            'IN_PROGRESS'
          )
      `)
      .get(fixtureId) as {
        id: number;
      } | undefined;


    if (!selected) {
      throw new Error(
        `Scheduled fixture ${fixtureId} not found (it may already be completed or is not playable).`
      );
    }
  } else {
    const metadata = db
      .prepare(`
        SELECT
          selected_club_id AS clubId

        FROM game_save_metadata

        LIMIT 1
      `)
      .get() as {
        clubId: number;
      } | undefined;


    if (!metadata) {
      throw new Error(
        "Campaign metadata is missing; cannot find the managed club's next match."
      );
    }


    selected = db
      .prepare(`
        SELECT
          f.id

        FROM fixture f

        WHERE f.status IN (
          'SCHEDULED',
          'IN_PROGRESS'
        )
          AND (
            f.home_club_id = ?
            OR f.away_club_id = ?
          )

        ORDER BY
          CASE f.status
            WHEN 'IN_PROGRESS' THEN 0
            ELSE 1
          END,
          f.scheduled_at,
          f.id

        LIMIT 1
      `)
      .get(
        metadata.clubId,
        metadata.clubId
      ) as {
        id: number;
      } | undefined;


    if (!selected) {
      throw new Error(
        "No scheduled or in-progress fixtures remain for your club."
      );
    }
  }


  const round = db
    .prepare(`
      SELECT
        r.id AS roundId,
        r.stage_id AS stageId

      FROM fixture f

      JOIN competition_round r
        ON r.id = f.round_id

      WHERE f.id = ?
    `)
    .get(selected.id) as {
      roundId: number;
      stageId: number;
    } | undefined;


  if (!round) {
    throw new Error(
      `Fixture ${selected.id} has no competition round.`
    );
  }


  return advanceRoundById(
    db,
    round.roundId,
    round.stageId
  );
}