import { SqliteDatabase } from "../../db/database.js";
import { getStage } from "./competitionService.js";


export interface KnockoutFixtureResult {
  fixtureId: number;
  winnerClubId: number;
  homePenalties: number | null;
  awayPenalties: number | null;
}


export function resolveKnockoutFixtureWinner(
  db: SqliteDatabase,
  fixtureId: number
): KnockoutFixtureResult {
  const fixture = db
    .prepare<
      number,
      {
        id: number;
        home: number;
        away: number;
        homeScore: number | null;
        awayScore: number | null;
        homePenalties: number | null;
        awayPenalties: number | null;
        seed: number | null;
        status: string;
        stageKind: string;
      }
    >(`
      SELECT
        f.id,
        f.home_club_id AS home,
        f.away_club_id AS away,
        f.home_score AS homeScore,
        f.away_score AS awayScore,
        f.home_penalties AS homePenalties,
        f.away_penalties AS awayPenalties,
        f.random_seed AS seed,
        f.status,
        st.stage_kind AS stageKind

      FROM fixture f

      JOIN competition_round r
        ON r.id = f.round_id

      JOIN competition_stage st
        ON st.id = r.stage_id

      WHERE f.id = ?
    `)
    .get(fixtureId);


  if (!fixture) {
    throw new Error(`Fixture ${fixtureId} was not found.`);
  }

  if (fixture.stageKind !== "KNOCKOUT") {
    throw new Error(
      `Fixture ${fixtureId} is not part of a knockout stage.`
    );
  }

  if (
    fixture.status !== "COMPLETED" ||
    fixture.homeScore === null ||
    fixture.awayScore === null
  ) {
    throw new Error(
      `Knockout fixture ${fixtureId} must be completed before its winner can be resolved.`
    );
  }


  let homePenalties = fixture.homePenalties;
  let awayPenalties = fixture.awayPenalties;

  let winnerClubId: number;


  if (fixture.homeScore !== fixture.awayScore) {
    winnerClubId =
      fixture.homeScore > fixture.awayScore
        ? fixture.home
        : fixture.away;
  } else {
    if (
      homePenalties === null ||
      awayPenalties === null ||
      homePenalties === awayPenalties
    ) {
      let state =
        ((fixture.seed ?? fixture.id) ^ (fixture.id * 2654435761)) >>> 0;

      const next = () => {
        state =
          (Math.imul(state, 1664525) + 1013904223) >>> 0;

        return state / 0x100000000;
      };


      homePenalties = 0;
      awayPenalties = 0;


      for (let kick = 0; kick < 5; kick++) {
        if (next() < 0.76) {
          homePenalties++;
        }

        if (next() < 0.76) {
          awayPenalties++;
        }
      }


      let suddenDeath = 0;

      while (
        homePenalties === awayPenalties &&
        suddenDeath < 20
      ) {
        const homeScores = next() < 0.76;
        const awayScores = next() < 0.76;

        if (homeScores) {
          homePenalties++;
        }

        if (awayScores) {
          awayPenalties++;
        }

        suddenDeath++;
      }


      if (homePenalties === awayPenalties) {
        homePenalties++;
      }


      db
        .prepare(
          "UPDATE fixture SET home_penalties=?,away_penalties=? WHERE id=?"
        )
        .run(
          homePenalties,
          awayPenalties,
          fixture.id
        );
    }


    winnerClubId =
      homePenalties > awayPenalties
        ? fixture.home
        : fixture.away;
  }


  return {
    fixtureId: fixture.id,
    winnerClubId,
    homePenalties,
    awayPenalties,
  };
}


export function progressKnockoutStage(
  db: SqliteDatabase,
  stageId: number,
  roundId: number
): void {
  const stage = getStage(db, stageId);

  if (stage.stage_kind !== "KNOCKOUT") {
    return;
  }


  const round = db
    .prepare<
      [number, number],
      {
        id: number;
        roundNumber: number;
        name: string;
      }
    >(`
      SELECT
        id,
        round_number AS roundNumber,
        name

      FROM competition_round

      WHERE id = ?
        AND stage_id = ?
    `)
    .get(roundId, stageId);


  if (!round) {
    throw new Error(
      `Round ${roundId} does not belong to knockout stage ${stageId}.`
    );
  }


  const roundState = db
    .prepare<
      number,
      {
        total: number;
        completed: number | null;
      }
    >(`
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
    .get(roundId);


  if (
    roundState?.total === 0 ||
    (roundState?.completed ?? 0) !== roundState?.total
  ) {
    return;
  }


  const laterRound = db
    .prepare<[number, number], number>(`
      SELECT id

      FROM competition_round

      WHERE stage_id = ?
        AND round_number > ?

      LIMIT 1
    `)
    .get(stageId, round.roundNumber);

  if (laterRound) {
    return;
  }


  const matches = db
    .prepare<
      number,
      {
        id: number;
        scheduledAt: string | null;
      }
    >(`
      SELECT
        id,
        scheduled_at AS scheduledAt

      FROM fixture

      WHERE round_id = ?

      ORDER BY
        scheduled_at,
        id
    `)
    .all(roundId);


  const winners = matches.map(
    match =>
      resolveKnockoutFixtureWinner(db, match.id).winnerClubId
  );


  if (winners.length === 1) {
    return;
  }

  if (
    winners.length < 2 ||
    winners.length % 2 !== 0
  ) {
    throw new Error(
      `Knockout stage ${stageId} produced ${winners.length} winners; an even number is required to create the next round.`
    );
  }


  const nextRoundNumber = round.roundNumber + 1;

  const roundName =
    winners.length === 2
      ? "Final"
      : winners.length === 4
        ? "Semifinais"
        : winners.length === 8
          ? "Quartas de final"
          : `Rodada eliminatória ${nextRoundNumber}`;


  const scheduledDates = matches
    .map(match => match.scheduledAt)
    .filter(
      (value): value is string =>
        Boolean(value)
    );

  scheduledDates.sort();


  const lastDate =
    scheduledDates.length
      ? scheduledDates[scheduledDates.length - 1]
      : undefined;

  const baseDate =
    lastDate
      ? new Date(lastDate)
      : new Date();

  baseDate.setUTCDate(
    baseDate.getUTCDate() + 7
  );


  const date = baseDate
    .toISOString()
    .slice(0, 10);


  const createNextRound = db.transaction(() => {
    const nextRoundId = db
      .prepare(`
        INSERT INTO competition_round (
          stage_id,
          round_number,
          name,
          start_date,
          end_date
        )
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        stageId,
        nextRoundNumber,
        roundName,
        date,
        date
      )
      .lastInsertRowid;


    const insertFixture = db.prepare(`
      INSERT INTO fixture (
        round_id,
        home_club_id,
        away_club_id,
        stadium_id,
        scheduled_at,
        random_seed
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `);


    winners.forEach((winner, index) => {
      if (index % 2 !== 0) {
        return;
      }


      const home = winner;
      const away = winners[index + 1]!;


      const stadium = db
        .prepare(
          "SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1"
        )
        .get(home) as { id: number } | undefined;


      const time =
        `${date}T${String(16 + (index / 2 % 2) * 2)
          .padStart(2, "0")}:00:00`;

      const seed =
        (
          (stage.season_year * 100000) +
          (nextRoundNumber * 100) +
          index +
          1
        ) >>> 0;


      insertFixture.run(
        nextRoundId,
        home,
        away,
        stadium?.id ?? null,
        time,
        seed
      );
    });


    db
      .prepare(
        "UPDATE competition_season SET status='ACTIVE' WHERE id=?"
      )
      .run(stage.season_id);
  });


  createNextRound();
}