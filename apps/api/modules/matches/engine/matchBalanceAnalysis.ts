import type {
  SqliteDatabase,
} from "../../../../db/database.js";
import {
  loadTeam,
} from "./teamService.js";
import {
  runMonteCarlo,
} from "./monteCarloService.js";
import type {
  MonteCarloReport,
} from "./types.js";


export function runMatchBalanceAnalysis(
  db: SqliteDatabase,
  clubA: number,
  clubB: number,
  simulations = 5000,
  seed = 73421
): MonteCarloReport {
  if (clubA === clubB) {
    throw new Error(
      "Balance analysis requires two different clubs."
    );
  }


  const fixture = db
    .prepare(`
      SELECT id

      FROM fixture

      WHERE status = ?
        AND (
          (
            home_club_id = ?
            AND away_club_id = ?
          )
          OR
          (
            home_club_id = ?
            AND away_club_id = ?
          )
        )

      ORDER BY id

      LIMIT 1
    `)
    .get(
      "SCHEDULED",
      clubA,
      clubB,
      clubB,
      clubA
    ) as {
      id: number;
    } | undefined;


  const fixtureId =
    fixture?.id ?? -1;


  if (fixtureId < 0) {
    return runMonteCarlo(
      loadTeam(
        db,
        -1,
        clubA,
        false
      ),
      loadTeam(
        db,
        -1,
        clubB,
        false
      ),
      simulations,
      seed
    );
  }


  return runMonteCarlo(
    loadTeam(
      db,
      fixtureId,
      clubA,
      false
    ),
    loadTeam(
      db,
      fixtureId,
      clubB,
      false
    ),
    simulations,
    seed
  );
}