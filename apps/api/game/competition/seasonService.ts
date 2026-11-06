import { SqliteDatabase } from "../../db/database.js";
import { ParticipantRow, roundRobin } from "../calendar/scheduleGenerator.js";
import { applyRosterSeason } from "../rosterLifecycle.js";
import {
  getSeasonStatus,
  getStage,
} from "./competitionService.js";


export function finishSeasonIfComplete(
  db: SqliteDatabase,
  stageId: number
): void {
  const stage = getStage(db, stageId);


  if (
    stage.stage_kind !== "LEAGUE" &&
    stage.stage_kind !== "KNOCKOUT"
  ) {
    return;
  }


  const counts = db
    .prepare<
      number,
      {
        total: number;
        completed: number | null;
        pending: number | null;
      }
    >(`
      SELECT
        COUNT(*) AS total,

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
    .get(stageId);


  const status = getSeasonStatus(db, stageId)[0];

  const canComplete =
    counts &&
    counts.total > 0 &&
    (counts.pending ?? 0) === 0 &&
    (
      stage.stage_kind !== "KNOCKOUT" ||
      status?.stageStatus === "COMPLETED"
    );


  db
    .prepare(
      "UPDATE competition_season SET status=? WHERE id=?"
    )
    .run(
      canComplete
        ? "COMPLETED"
        : "ACTIVE",
      stage.season_id
    );
}


export function prepareNextLeagueSeason(
  db: SqliteDatabase,
  stageId: number
): {
  seasonId: number;
  year: number;
  fixtures: number;
} {
  const stage = getStage(db, stageId);


  if (stage.stage_kind !== "LEAGUE") {
    throw new Error(
      "Only league stages can generate the next season in this MVP."
    );
  }

  if (stage.season_status !== "COMPLETED") {
    throw new Error(
      "Cannot prepare a new season before the current season is completed."
    );
  }


  const existing = db
    .prepare<
      [number, number],
      {
        seasonId: number;
        year: number;
        stageId: number;
        fixtureCount: number;
      }
    >(`
      SELECT
        cs.id AS seasonId,
        cs.season_year AS year,
        st.id AS stageId,
        COUNT(f.id) AS fixtureCount

      FROM competition_season cs

      JOIN competition_stage st
        ON st.season_id = cs.id

      LEFT JOIN competition_round r
        ON r.stage_id = st.id

      LEFT JOIN fixture f
        ON f.round_id = r.id

      WHERE cs.competition_id = ?
        AND cs.season_year = ?

      GROUP BY
        cs.id,
        st.id
    `)
    .get(
      stage.competition_id,
      stage.season_year + 1
    );


  if (existing) {
    applyRosterSeason(db, existing.year);

    return {
      seasonId: existing.seasonId,
      year: existing.year,
      fixtures: existing.fixtureCount,
    };
  }


  const format = db
    .prepare(
      "SELECT * FROM stage_format WHERE stage_id=?"
    )
    .get(stageId) as {
      legs: number;
      group_count: number;
      home_away: number;
      extra_time: number;
      penalties: number;
      away_goals_rule: number;
      win_points: number;
      draw_points: number;
      loss_points: number;
    } | undefined;


  const legs = format?.legs ?? 1;


  const participants = db
    .prepare(
      "SELECT club_id,group_id,seed FROM stage_participant WHERE stage_id=? ORDER BY seed,club_id"
    )
    .all(stageId) as ParticipantRow[];


  if (participants.length < 2) {
    throw new Error(
      "Cannot generate a league season without at least two participants."
    );
  }


  const create = db.transaction(() => {
    const year = stage.season_year + 1;


    const seasonId = db
      .prepare(`
        INSERT INTO competition_season (
          competition_id,
          season_year,
          status
        )
        VALUES (?, ?, 'PLANNED')
      `)
      .run(
        stage.competition_id,
        year
      )
      .lastInsertRowid as number;


    const newStageId = db
      .prepare(`
        INSERT INTO competition_stage (
          season_id,
          name,
          stage_order,
          stage_kind
        )
        VALUES (?, ?, 1, 'LEAGUE')
      `)
      .run(
        seasonId,
        stage.stage
      )
      .lastInsertRowid as number;


    db
      .prepare(`
        INSERT INTO stage_format (
          stage_id,
          group_count,
          legs,
          home_away,
          extra_time,
          penalties,
          away_goals_rule,
          win_points,
          draw_points,
          loss_points
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        newStageId,
        format?.group_count ?? 1,
        legs,
        format?.home_away ?? 1,
        format?.extra_time ?? 0,
        format?.penalties ?? 0,
        format?.away_goals_rule ?? 0,
        format?.win_points ?? 3,
        format?.draw_points ?? 1,
        format?.loss_points ?? 0
      );


    db
      .prepare(`
        INSERT INTO stage_group (
          stage_id,
          group_code,
          name,
          sort_order
        )
        SELECT
          ?,
          group_code,
          name,
          sort_order
        FROM stage_group
        WHERE stage_id = ?
      `)
      .run(
        newStageId,
        stageId
      );


    db
      .prepare(`
        INSERT INTO stage_standing_rule (
          stage_id,
          rule_order,
          rule_key
        )
        SELECT
          ?,
          rule_order,
          rule_key
        FROM stage_standing_rule
        WHERE stage_id = ?
      `)
      .run(
        newStageId,
        stageId
      );


    db
      .prepare(`
        INSERT INTO schedule_profile (
          stage_id,
          min_rest_hours,
          max_matches_7_days,
          default_match_duration_minutes,
          home_away_balance,
          avoid_same_opponent_consecutive,
          travel_fatigue_enabled
        )
        SELECT
          ?,
          min_rest_hours,
          max_matches_7_days,
          default_match_duration_minutes,
          home_away_balance,
          avoid_same_opponent_consecutive,
          travel_fatigue_enabled
        FROM schedule_profile
        WHERE stage_id = ?
      `)
      .run(
        newStageId,
        stageId
      );


    const newGroups = db
      .prepare(`
        SELECT
          id,
          group_code,
          sort_order
        FROM stage_group
        WHERE stage_id = ?
        ORDER BY sort_order
      `)
      .all(newStageId) as Array<{
        id: number;
        group_code: string;
        sort_order: number;
      }>;


    const oldGroups = db
      .prepare(`
        SELECT
          id,
          group_code
        FROM stage_group
        WHERE stage_id = ?
      `)
      .all(stageId) as Array<{
        id: number;
        group_code: string;
      }>;


    const oldCode = new Map(
      oldGroups.map(group => [
        group.id,
        group.group_code,
      ])
    );

    const groupIds = new Map(
      newGroups.map(group => [
        group.group_code,
        group.id,
      ])
    );


    const insertParticipant = db.prepare(`
      INSERT INTO stage_participant (
        stage_id,
        club_id,
        group_id,
        seed
      )
      VALUES (?, ?, ?, ?)
    `);

    const insertStanding = db.prepare(`
      INSERT INTO stage_standing (
        stage_id,
        club_id,
        group_id
      )
      VALUES (?, ?, ?)
    `);


    participants.forEach((participant, index) => {
      const groupId =
        groupIds.get(
          oldCode.get(participant.group_id) ?? ""
        ) ?? newGroups[0]!.id;

      insertParticipant.run(
        newStageId,
        participant.club_id,
        groupId,
        index + 1
      );

      insertStanding.run(
        newStageId,
        participant.club_id,
        groupId
      );
    });


    const rounds = roundRobin(
      participants,
      legs
    );


    const insertRound = db.prepare(`
      INSERT INTO competition_round (
        stage_id,
        round_number,
        name,
        start_date,
        end_date
      )
      VALUES (?, ?, ?, ?, ?)
    `);

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


    const firstDate = new Date(
      Date.UTC(year, 0, 10)
    );

    let fixtureCount = 0;


    rounds.forEach((matches, roundIndex) => {
      const date = new Date(
        firstDate.getTime() +
        roundIndex * 7 * 86400000
      )
        .toISOString()
        .slice(0, 10);


      const roundId = insertRound
        .run(
          newStageId,
          roundIndex + 1,
          `Rodada ${roundIndex + 1}`,
          date,
          date
        )
        .lastInsertRowid as number;


      matches.forEach((match, matchIndex) => {
        const stadium = db
          .prepare(
            "SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1"
          )
          .get(match.home) as {
            id: number;
          } | undefined;


        const time =
          `${date}T${String(16 + (matchIndex % 2) * 2)
            .padStart(2, "0")}:00:00`;

        const seed =
          (
            year * 100000 +
            (roundIndex + 1) * 100 +
            matchIndex +
            1
          ) >>> 0;


        insertFixture.run(
          roundId,
          match.home,
          match.away,
          stadium?.id ?? null,
          time,
          seed
        );

        fixtureCount++;
      });
    });


    // Keep new-season creation and roster/finance lifecycle in one transaction.
    // applyRosterSeason is idempotent, and its transaction becomes a savepoint here.
    applyRosterSeason(db, year);


    return {
      seasonId,
      year,
      fixtures: fixtureCount,
    };
  });


  return create.immediate();
}