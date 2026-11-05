import { SqliteDatabase } from "../../db/database.js";
import { progressKnockoutStage } from "../competition/knockoutService.js";
import { finishSeasonIfComplete } from "../competition/seasonService.js";
import { rebuildStandings } from "../competition/standingsService.js";
import { MatchSummary, simulateMatch } from "../matchEngine.js";


export function advanceRound(
  db: SqliteDatabase,
  roundId: number
): MatchSummary[] {
  const round = db
    .prepare(
      "SELECT id,stage_id AS stageId FROM competition_round WHERE id=?"
    )
    .get(roundId) as {
      id: number;
      stageId: number;
    } | undefined;


  if (!round) {
    throw new Error(
      `Round ID ${roundId} was not found.`
    );
  }


  return advanceRoundById(
    db,
    round.id,
    round.stageId
  );
}


/** Resolve a round by its sequence within a stage, never by a global database ID. */
export function advanceStageRound(
  db: SqliteDatabase,
  stageId: number,
  roundNumber: number
): MatchSummary[] {
  const round = db
    .prepare(`
      SELECT
        id,
        stage_id AS stageId

      FROM competition_round

      WHERE stage_id = ?
        AND round_number = ?
    `)
    .get(
      stageId,
      roundNumber
    ) as {
      id: number;
      stageId: number;
    } | undefined;


  if (!round) {
    const available = db
      .prepare(`
        SELECT
          round_number AS roundNumber,
          name

        FROM competition_round

        WHERE stage_id = ?

        ORDER BY round_number
      `)
      .all(stageId) as Array<{
        roundNumber: number;
        name: string;
      }>;


    const description = available
      .map(
        item => `${item.roundNumber} (${item.name})`
      )
      .join(", ");


    throw new Error(
      `Round number ${roundNumber} was not found in stage ${stageId}. Available rounds: ${description || "none"}.`
    );
  }


  return advanceRoundById(
    db,
    round.id,
    round.stageId
  );
}


export function advanceRoundById(
  db: SqliteDatabase,
  roundId: number,
  stageId: number
): MatchSummary[] {
  const round = db
    .prepare(`
      SELECT
        round_number AS roundNumber,
        name

      FROM competition_round

      WHERE id = ?
        AND stage_id = ?
    `)
    .get(
      roundId,
      stageId
    ) as {
      roundNumber: number;
      name: string;
    } | undefined;


  if (!round) {
    throw new Error(
      `Round ID ${roundId} was not found in stage ${stageId}.`
    );
  }


  const state = db
    .prepare(`
      SELECT
        COUNT(*) AS total,

        SUM(
          CASE
            WHEN status = 'COMPLETED' THEN 1
            ELSE 0
          END
        ) AS completed

      FROM fixture

      WHERE round_id = ?
    `)
    .get(roundId) as {
      total: number;
      completed: number | null;
    };


  const fixtures = db
    .prepare(`
      SELECT
        id

      FROM fixture

      WHERE round_id = ?
        AND status IN (
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
    `)
    .all(roundId) as Array<{
      id: number;
    }>;


  if (!fixtures.length) {
    if (
      state.total > 0 &&
      (state.completed ?? 0) === state.total
    ) {
      // Recover post-match bookkeeping if the process stopped after the final
      // fixture committed but before knockout progression/standings/season status.
      const recoverRound = db.transaction(() => {
        progressKnockoutStage(
          db,
          stageId,
          roundId
        );

        rebuildStandings(
          db,
          stageId
        );

        finishSeasonIfComplete(
          db,
          stageId
        );
      });


      recoverRound.immediate();


      throw new Error(
        `Round ${round.roundNumber} (${round.name}) is already completed; no matches were simulated.`
      );
    }


    throw new Error(
      `Round ${round.roundNumber} (${round.name}) has no playable fixtures.`
    );
  }


  // Each match owns its per-minute transactions. One malformed fixture must not
  // prevent the remaining matches in the same round from being simulated.
  const results: MatchSummary[] = [];
  const failures: string[] = [];


  for (const fixture of fixtures) {
    try {
      results.push(
        simulateMatch(
          db,
          fixture.id
        )
      );
    } catch (error) {
      failures.push(
        `fixture ${fixture.id}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }


  const finalizeRound = db.transaction(() => {
    progressKnockoutStage(
      db,
      stageId,
      roundId
    );

    rebuildStandings(
      db,
      stageId
    );

    finishSeasonIfComplete(
      db,
      stageId
    );
  });


  finalizeRound.immediate();


  if (failures.length) {
    throw new Error(
      `Round ${round.roundNumber} simulated ${results.length}/${fixtures.length} matches. Failures: ${failures.join(" | ")}`
    );
  }


  return results;
}