import { SqliteDatabase } from "../../../db/database.js";
import { getStage } from "./competition.repository.js";


export interface StandingRow {
  stageId: number;
  groupId: number;
  clubId: number;
  club: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  fairPlayPoints: number;
}


type StandingTieBreak = {
  points: number;
  goalDifference: number;
  goalsFor: number;
};


const standingFields: Record<string, keyof StandingRow> = {
  POINTS: "points",
  WINS: "wins",
  GOAL_DIFFERENCE: "goalDifference",
  GOALS_FOR: "goalsFor",
  FAIR_PLAY: "fairPlayPoints",
  DRAW: "draws",
};


export function getStandings(
  db: SqliteDatabase,
  stageId: number,
  refreshCache = true
): StandingRow[] {
  if (refreshCache) {
    rebuildStandings(db, stageId);
  }


  const rules = db
    .prepare<
      number,
      {
        rule_key: string;
      }
    >(
      "SELECT rule_key FROM stage_standing_rule WHERE stage_id=? ORDER BY rule_order"
    )
    .all(stageId);


  const rows = db
    .prepare<number, StandingRow>(`
      SELECT
        ss.stage_id AS stageId,
        ss.group_id AS groupId,
        ss.club_id AS clubId,
        c.name AS club,
        ss.played,
        ss.wins,
        ss.draws,
        ss.losses,
        ss.goals_for AS goalsFor,
        ss.goals_against AS goalsAgainst,
        ss.goals_for - ss.goals_against AS goalDifference,
        ss.points,
        ss.fair_play_points AS fairPlayPoints

      FROM stage_standing ss

      JOIN club c
        ON c.id = ss.club_id

      WHERE ss.stage_id = ?
    `)
    .all(stageId);


  let groups: StandingRow[][] = [rows];


  for (const { rule_key } of rules) {
    const refined: StandingRow[][] = [];


    for (const group of groups) {
      if (group.length < 2) {
        refined.push(group);
        continue;
      }


      if (rule_key === "HEAD_TO_HEAD") {
        const ids = group.map(
          row => row.clubId
        );


        const stats = new Map<number, StandingTieBreak>(
          ids.map(
            id => [
              id,
              {
                points: 0,
                goalDifference: 0,
                goalsFor: 0,
              },
            ]
          )
        );


        const fixtures = db
          .prepare<
            [number, ...number[]],
            {
              home: number;
              away: number;
              homeScore: number;
              awayScore: number;
              winPoints: number | null;
              drawPoints: number | null;
              lossPoints: number | null;
            }
          >(`
            SELECT
              f.home_club_id AS home,
              f.away_club_id AS away,
              f.home_score AS homeScore,
              f.away_score AS awayScore,
              sf.win_points AS winPoints,
              sf.draw_points AS drawPoints,
              sf.loss_points AS lossPoints

            FROM fixture f

            JOIN competition_round r
              ON r.id = f.round_id

            LEFT JOIN stage_format sf
              ON sf.stage_id = r.stage_id

            WHERE r.stage_id = ?
              AND f.status = 'COMPLETED'
              AND f.home_club_id IN (
                ${ids.map(() => "?").join(",")}
              )
              AND f.away_club_id IN (
                ${ids.map(() => "?").join(",")}
              )
          `)
          .all(
            stageId,
            ...ids,
            ...ids
          );


        for (const fixture of fixtures) {
          const home = stats.get(fixture.home)!;
          const away = stats.get(fixture.away)!;


          home.goalsFor += fixture.homeScore;
          home.goalDifference +=
            fixture.homeScore - fixture.awayScore;

          away.goalsFor += fixture.awayScore;
          away.goalDifference +=
            fixture.awayScore - fixture.homeScore;


          if (fixture.homeScore > fixture.awayScore) {
            home.points += fixture.winPoints ?? 3;
            away.points += fixture.lossPoints ?? 0;
          } else if (fixture.homeScore < fixture.awayScore) {
            away.points += fixture.winPoints ?? 3;
            home.points += fixture.lossPoints ?? 0;
          } else {
            home.points += fixture.drawPoints ?? 1;
            away.points += fixture.drawPoints ?? 1;
          }
        }


        const compare = (
          a: StandingRow,
          b: StandingRow
        ) => {
          const x = stats.get(a.clubId)!;
          const y = stats.get(b.clubId)!;

          return (
            y.points - x.points ||
            y.goalDifference - x.goalDifference ||
            y.goalsFor - x.goalsFor
          );
        };


        const sorted = [...group].sort(compare);

        let tie: StandingRow[] = [];
        let previous: StandingTieBreak | undefined;


        for (const row of sorted) {
          const value = stats.get(row.clubId)!;

          if (
            previous &&
            (
              value.points !== previous.points ||
              value.goalDifference !== previous.goalDifference ||
              value.goalsFor !== previous.goalsFor
            )
          ) {
            refined.push(tie);
            tie = [];
          }

          tie.push(row);
          previous = value;
        }


        if (tie.length) {
          refined.push(tie);
        }

        continue;
      }


      const field = standingFields[rule_key];


      if (!field) {
        refined.push(group);
        continue;
      }


      const direction =
        rule_key === "FAIR_PLAY"
          ? 1
          : -1;

      const sorted = [...group].sort(
        (a, b) =>
          direction *
          (
            Number(a[field]) -
            Number(b[field])
          )
      );


      let tie: StandingRow[] = [];
      let previousValue: number | undefined;


      for (const row of sorted) {
        const value = Number(row[field]);

        if (
          previousValue !== undefined &&
          value !== previousValue
        ) {
          refined.push(tie);
          tie = [];
        }

        tie.push(row);
        previousValue = value;
      }


      if (tie.length) {
        refined.push(tie);
      }
    }


    groups = refined;
  }


  return groups.flatMap(
    group =>
      group.length > 1
        ? [...group].sort(
            (a, b) =>
              a.club.localeCompare(
                b.club,
                "pt-BR"
              ) ||
              a.clubId - b.clubId
          )
        : group
  );
}


export function rebuildStandings(
  db: SqliteDatabase,
  stageId: number
): void {
  getStage(db, stageId);


  const rebuild = db.transaction(() => {
    db
      .prepare(
        "DELETE FROM stage_standing WHERE stage_id=?"
      )
      .run(stageId);


    db
      .prepare(`
        INSERT INTO stage_standing (
          stage_id,
          club_id,
          group_id,
          played,
          wins,
          draws,
          losses,
          goals_for,
          goals_against,
          points,
          fair_play_points
        )
        SELECT
          stage_id,
          club_id,
          group_id,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0
        FROM stage_participant
        WHERE stage_id = ?
      `)
      .run(stageId);


    const fixtures = db
      .prepare<
        number,
        {
          home: number;
          away: number;
          homeScore: number;
          awayScore: number;
          winPoints: number | null;
          drawPoints: number | null;
          lossPoints: number | null;
        }
      >(`
        SELECT
          f.home_club_id AS home,
          f.away_club_id AS away,
          f.home_score AS homeScore,
          f.away_score AS awayScore,
          sf.win_points AS winPoints,
          sf.draw_points AS drawPoints,
          sf.loss_points AS lossPoints

        FROM fixture f

        JOIN competition_round r
          ON r.id = f.round_id

        LEFT JOIN stage_format sf
          ON sf.stage_id = r.stage_id

        WHERE r.stage_id = ?
          AND f.status = 'COMPLETED'
      `)
      .all(stageId);


    const update = db.prepare(`
      UPDATE stage_standing
      SET
        played = played + 1,
        wins = wins + ?,
        draws = draws + ?,
        losses = losses + ?,
        goals_for = goals_for + ?,
        goals_against = goals_against + ?,
        points = points + ?
      WHERE stage_id = ?
        AND club_id = ?
    `);


    for (const f of fixtures) {
      let hp = 0;
      let ap = 0;

      let hw = 0;
      let hd = 0;
      let hl = 0;

      let aw = 0;
      let ad = 0;
      let al = 0;


      if (f.homeScore > f.awayScore) {
        hp = f.winPoints ?? 3;
        ap = f.lossPoints ?? 0;

        hw = 1;
        al = 1;
      } else if (f.homeScore < f.awayScore) {
        ap = f.winPoints ?? 3;
        hp = f.lossPoints ?? 0;

        aw = 1;
        hl = 1;
      } else {
        hp = f.drawPoints ?? 1;
        ap = f.drawPoints ?? 1;

        hd = 1;
        ad = 1;
      }


      update.run(
        hw,
        hd,
        hl,
        f.homeScore,
        f.awayScore,
        hp,
        stageId,
        f.home
      );


      update.run(
        aw,
        ad,
        al,
        f.awayScore,
        f.homeScore,
        ap,
        stageId,
        f.away
      );
    }


    db
      .prepare(`
        UPDATE stage_standing

        SET fair_play_points = COALESCE(
          (
            SELECT
              SUM(
                CASE e.event_type
                  WHEN 'YELLOW_CARD' THEN 1
                  WHEN 'RED_CARD' THEN 3
                  ELSE 0
                END
              )

            FROM match_event e

            JOIN fixture f
              ON f.id = e.fixture_id

            JOIN competition_round r
              ON r.id = f.round_id

            WHERE r.stage_id = stage_standing.stage_id
              AND f.status = 'COMPLETED'
              AND e.club_id = stage_standing.club_id
              AND e.event_type IN (
                'YELLOW_CARD',
                'RED_CARD'
              )
          ),
          0
        )

        WHERE stage_id = ?
      `)
      .run(stageId);
  });


  rebuild();
}