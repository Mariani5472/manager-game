import { SqliteDatabase } from "../../../db/database.js";
import {
  ParticipantRow,
  roundRobin,
} from "../../competitions/service/schedule-generator.service.js";
import {
  ensureFactorySquadProfiles,
  FactoryCalendarRepair,
} from "./squad-profile.service.js";


/**
 * Upgrade only the untouched factory world to 16 playable clubs.
 * Existing saves are independent copies.
 */
export function ensureFactoryWorld16(
  db: SqliteDatabase
): {
  upgraded: boolean;
  clubs: number;
  leagueFixtures: number;
  cupEntrants: number;
} {
  const clubCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM club"
      )
      .get() as {
        count: number;
      }
  ).count;


  const league = db
    .prepare(`
      SELECT
        st.id AS stageId,
        cs.id AS seasonId

      FROM competition_stage st

      JOIN competition_season cs
        ON cs.id = st.season_id

      JOIN competition co
        ON co.id = cs.competition_id

      WHERE co.name = 'Liga Nacional de Teste'
        AND cs.season_year = 2026
        AND st.stage_kind = 'LEAGUE'
    `)
    .get() as {
      stageId: number;
      seasonId: number;
    } | undefined;


  const cup = db
    .prepare(`
      SELECT
        st.id AS stageId,
        cs.id AS seasonId

      FROM competition_stage st

      JOIN competition_season cs
        ON cs.id = st.season_id

      JOIN competition co
        ON co.id = cs.competition_id

      WHERE co.name = 'Copa Nacional de Teste'
        AND cs.season_year = 2026
        AND st.stage_kind = 'KNOCKOUT'
    `)
    .get() as {
      stageId: number;
      seasonId: number;
    } | undefined;


  if (!league || !cup) {
    throw new Error(
      "The factory league or cup was not found; the 16-club upgrade was not applied."
    );
  }


  const leagueCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM stage_participant WHERE stage_id=?"
      )
      .get(league.stageId) as {
        count: number;
      }
  ).count;


  const cupCount = (
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM stage_participant WHERE stage_id=?"
      )
      .get(cup.stageId) as {
        count: number;
      }
  ).count;


  const leagueFixtures = (
    db
      .prepare(`
        SELECT
          COUNT(*) AS count

        FROM fixture f

        JOIN competition_round r
          ON r.id = f.round_id

        WHERE r.stage_id = ?
      `)
      .get(league.stageId) as {
        count: number;
      }
  ).count;


  if (
    clubCount === 16 &&
    leagueCount === 16 &&
    cupCount === 16
  ) {
    ensureFactorySquadProfiles(db);

    return {
      upgraded: false,
      clubs: 16,
      leagueFixtures,
      cupEntrants: 16,
    };
  }


  if (
    clubCount !== 4 ||
    leagueCount !== 4 ||
    cupCount !== 4
  ) {
    throw new Error(
      "Factory world is neither the original four-club seed nor a complete 16-club world; no automatic upgrade was attempted."
    );
  }


  const played = (
    db
      .prepare(`
        SELECT
          COUNT(*) AS count

        FROM fixture

        WHERE status <> 'SCHEDULED'
      `)
      .get() as {
        count: number;
      }
  ).count;


  if (played > 0) {
    throw new Error(
      "The factory world contains played or non-scheduled fixtures. It was not upgraded; existing saves are not changed."
    );
  }


  const names = [
    [
      "Atlético das Palmeiras",
      "ADP",
      46,
    ],
    [
      "Real de Santa Luzia",
      "RSL",
      44,
    ],
    [
      "Grêmio da Serra",
      "GDS",
      42,
    ],
    [
      "Ferroviário do Litoral",
      "FDL",
      40,
    ],
    [
      "Esportivo Campo Azul",
      "ECA",
      38,
    ],
    [
      "Nacional de Pedra Branca",
      "NPB",
      36,
    ],
    [
      "Desportivo São Bento",
      "DSB",
      34,
    ],
    [
      "Associação Vila Nova",
      "AVN",
      32,
    ],
    [
      "Clube Atlético do Cerrado",
      "CAC",
      30,
    ],
    [
      "União das Águas",
      "UDA",
      28,
    ],
    [
      "Operário de Santa Rita",
      "OSR",
      26,
    ],
    [
      "Independente do Sul",
      "IDS",
      24,
    ],
  ] as const;


  const attributeColumns = (
    db.pragma(
      "table_info(player_attribute)"
    ) as Array<{
      name: string;
    }>
  )
    .map(row => row.name)
    .filter(name => name !== "player_id");


  const playerColumns = (
    db.pragma(
      "table_info(player)"
    ) as Array<{
      name: string;
    }>
  )
    .map(row => row.name)
    .filter(name => name !== "person_id");


  const nextPersonId = (
    db
      .prepare(`
        SELECT
          COALESCE(MAX(id), 0) + 1 AS id

        FROM person
      `)
      .get() as {
        id: number;
      }
  ).id;


  const insertWorld = db.transaction(() => {
    const insertClub = db.prepare(`
      INSERT INTO club (
        id,
        nation_id,
        city_id,
        name,
        short_name,
        reputation
      )
      VALUES (?, 1, ?, ?, ?, ?)
    `);


    const insertStadium = db.prepare(`
      INSERT INTO stadium (
        club_id,
        city_id,
        name,
        capacity,
        pitch_quality
      )
      VALUES (?, ?, ?, ?, ?)
    `);


    const insertPerson = db.prepare(`
      INSERT INTO person (
        id,
        full_name,
        birth_date,
        nationality_id
      )
      VALUES (?, ?, ?, 1)
    `);


    const insertPlayer = db.prepare(
      "INSERT INTO player(person_id," +
      playerColumns.join(",") +
      ") SELECT ?," +
      playerColumns.join(",") +
      " FROM player WHERE person_id=?"
    );


    const insertAttributes = db.prepare(
      "INSERT INTO player_attribute(player_id," +
      attributeColumns.join(",") +
      ") SELECT ?," +
      attributeColumns.join(",") +
      " FROM player_attribute WHERE player_id=?"
    );


    const insertPositions = db.prepare(`
      INSERT INTO player_position (
        player_id,
        position_code,
        rating
      )
      SELECT
        ?,
        position_code,
        rating
      FROM player_position
      WHERE player_id = ?
    `);


    const insertMembership = db.prepare(`
      INSERT INTO squad_membership (
        player_id,
        club_id,
        shirt_number,
        squad_status
      )
      VALUES (?, ?, ?, 'FIRST_TEAM')
    `);


    const insertCondition = db.prepare(`
      INSERT INTO player_condition (
        player_id,
        energy,
        morale,
        sharpness,
        injured_until,
        suspension_matches
      )
      SELECT
        ?,
        energy,
        morale,
        sharpness,
        NULL,
        0
      FROM player_condition
      WHERE player_id = ?
    `);


    const sourceSquads = db.prepare(`
      SELECT
        sm.player_id AS playerId,
        sm.shirt_number AS shirtNumber,
        pe.birth_date AS birthDate

      FROM squad_membership sm

      JOIN person pe
        ON pe.id = sm.player_id

      WHERE sm.club_id = ?

      ORDER BY
        sm.shirt_number,
        sm.player_id
    `);


    let personId = nextPersonId;


    for (
      let index = 0;
      index < names.length;
      index++
    ) {
      const clubId = 5 + index;

      const cityId =
        clubId % 2 === 1
          ? 1
          : 2;

      const [
        name,
        short,
        reputation,
      ] = names[index]!;


      insertClub.run(
        clubId,
        cityId,
        name,
        short,
        reputation
      );


      insertStadium.run(
        clubId,
        cityId,
        "Estádio " + name,
        7000 + reputation * 250,
        58 + Math.floor(reputation / 4)
      );


      db
        .prepare(
          "INSERT INTO team_tactic(club_id,formation_id) VALUES(?,1)"
        )
        .run(clubId);


      const sourceClub = 1 + (index % 4);


      for (
        const source of sourceSquads.all(
          sourceClub
        ) as Array<{
          playerId: number;
          shirtNumber: number;
          birthDate: string | null;
        }>
      ) {
        const id = personId++;


        insertPerson.run(
          id,
          "Jogador " + id + " - " + name,
          source.birthDate
        );

        insertPlayer.run(
          id,
          source.playerId
        );

        insertAttributes.run(
          id,
          source.playerId
        );

        insertPositions.run(
          id,
          source.playerId
        );

        insertMembership.run(
          id,
          clubId,
          source.shirtNumber
        );

        insertCondition.run(
          id,
          source.playerId
        );
      }
    }


    db
      .prepare(
        "DELETE FROM competition_round WHERE stage_id IN (?,?)"
      )
      .run(
        league.stageId,
        cup.stageId
      );

    db
      .prepare(
        "DELETE FROM stage_standing WHERE stage_id=?"
      )
      .run(league.stageId);

    db
      .prepare(
        "DELETE FROM stage_participant WHERE stage_id IN (?,?)"
      )
      .run(
        league.stageId,
        cup.stageId
      );

    db
      .prepare(
        "DELETE FROM competition_entry WHERE season_id IN (?,?)"
      )
      .run(
        league.seasonId,
        cup.seasonId
      );


    const clubs = db
      .prepare(`
        SELECT id

        FROM club

        ORDER BY id
      `)
      .all() as Array<{
        id: number;
      }>;


    const insertParticipant = db.prepare(`
      INSERT INTO stage_participant (
        stage_id,
        club_id,
        group_id,
        seed
      )
      VALUES (?, ?, ?, ?)
    `);

    const insertEntry = db.prepare(`
      INSERT INTO competition_entry (
        season_id,
        club_id,
        seed
      )
      VALUES (?, ?, ?)
    `);


    clubs.forEach((club, index) => {
      const seed = index + 1;


      insertParticipant.run(
        league.stageId,
        club.id,
        1,
        seed
      );

      insertParticipant.run(
        cup.stageId,
        club.id,
        2,
        seed
      );

      insertEntry.run(
        league.seasonId,
        club.id,
        seed
      );

      insertEntry.run(
        cup.seasonId,
        club.id,
        seed
      );


      db
        .prepare(`
          INSERT INTO stage_standing (
            stage_id,
            club_id,
            group_id
          )
          VALUES (?, ?, 1)
        `)
        .run(
          league.stageId,
          club.id
        );
    });


    db
      .prepare(`
        UPDATE competition_season
        SET status = 'PLANNED'
        WHERE id IN (?, ?)
      `)
      .run(
        league.seasonId,
        cup.seasonId
      );


    const cupStart = "2026-03-01";


    const cupRoundId = Number(
      db
        .prepare(`
          INSERT INTO competition_round (
            stage_id,
            round_number,
            name,
            start_date,
            end_date
          )
          VALUES (?, 1, 'Oitavas de final', ?, ?)
        `)
        .run(
          cup.stageId,
          cupStart,
          cupStart
        )
        .lastInsertRowid
    );


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


    for (
      let i = 0;
      i < clubs.length;
      i += 2
    ) {
      const home = clubs[i]!;
      const away = clubs[i + 1]!;


      const stadium = db
        .prepare(
          "SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1"
        )
        .get(home.id) as {
          id: number;
        } | undefined;


      insertFixture.run(
        cupRoundId,
        home.id,
        away.id,
        stadium?.id ?? null,
        cupStart +
          "T" +
          String(14 + (i / 2 % 4) * 2)
            .padStart(2, "0") +
          ":00:00",
        22001 + i
      );
    }
  });


  insertWorld();


  const calendar = ensureFactoryLeagueCalendar(db);

  ensureFactorySquadProfiles(db);


  if (calendar.fixtures !== 240) {
    throw new Error(
      "The 16-club league calendar was not generated correctly (" +
      calendar.fixtures +
      " fixtures)."
    );
  }


  return {
    upgraded: true,
    clubs: 16,
    leagueFixtures: calendar.fixtures,
    cupEntrants: 16,
  };
}


/**
 * Reconcile the untouched factory league calendar without modifying played matches.
 */
export function ensureFactoryLeagueCalendar(
  db: SqliteDatabase
): FactoryCalendarRepair {
  const stage = db
    .prepare(`
      SELECT
        st.id AS stageId,
        cs.season_year AS year,
        cs.start_date AS startDate,
        sf.legs AS legs

      FROM competition_stage st

      JOIN competition_season cs
        ON cs.id = st.season_id

      JOIN competition co
        ON co.id = cs.competition_id

      JOIN stage_format sf
        ON sf.stage_id = st.id

      WHERE co.name = 'Liga Nacional de Teste'
        AND cs.season_year = 2026
        AND st.stage_kind = 'LEAGUE'

      ORDER BY st.id

      LIMIT 1
    `)
    .get() as {
      stageId: number;
      year: number;
      startDate: string | null;
      legs: number;
    } | undefined;


  if (
    !stage ||
    stage.legs !== 2
  ) {
    return {
      repaired: false,
      rounds: 0,
      fixtures: 0,
    };
  }


  const participants = db
    .prepare(`
      SELECT
        club_id,
        group_id,
        seed

      FROM stage_participant

      WHERE stage_id = ?

      ORDER BY
        seed,
        club_id
    `)
    .all(stage.stageId) as ParticipantRow[];


  if (participants.length < 2) {
    return {
      repaired: false,
      rounds: 0,
      fixtures: 0,
    };
  }


  const rounds = roundRobin(
    participants,
    stage.legs
  );


  const currentRounds = db
    .prepare(`
      SELECT
        id,
        round_number AS roundNumber

      FROM competition_round

      WHERE stage_id = ?

      ORDER BY round_number
    `)
    .all(stage.stageId) as Array<{
      id: number;
      roundNumber: number;
    }>;


  const currentFixtures = db
    .prepare(`
      SELECT
        f.id,
        f.status

      FROM fixture f

      JOIN competition_round r
        ON r.id = f.round_id

      WHERE r.stage_id = ?
    `)
    .all(stage.stageId) as Array<{
      id: number;
      status: string;
    }>;


  const roundCounts = db
    .prepare(`
      SELECT
        COUNT(f.id) AS fixtures

      FROM competition_round r

      LEFT JOIN fixture f
        ON f.round_id = r.id

      WHERE r.stage_id = ?

      GROUP BY r.id
    `)
    .all(stage.stageId) as Array<{
      fixtures: number;
    }>;


  const expectedFixtures = rounds.reduce(
    (sum, round) => sum + round.length,
    0
  );


  const isCorrect =
    currentRounds.length === rounds.length &&
    currentRounds.every(
      (round, index) =>
        round.roundNumber === index + 1
    ) &&
    currentFixtures.length === expectedFixtures &&
    roundCounts.length === rounds.length &&
    roundCounts.every(
      row =>
        row.fixtures ===
        Math.floor(participants.length / 2)
    );


  if (isCorrect) {
    return {
      repaired: false,
      rounds: currentRounds.length,
      fixtures: currentFixtures.length,
    };
  }


  if (
    currentFixtures.some(
      fixture =>
        fixture.status !== "SCHEDULED"
    )
  ) {
    throw new Error(
      "The factory league calendar is incomplete but contains played or non-scheduled fixtures. It was not changed; back up the master database before any manual repair."
    );
  }


  const create = db.transaction(() => {
    db
      .prepare(
        "DELETE FROM competition_round WHERE stage_id=?"
      )
      .run(stage.stageId);


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


    const start =
      stage.startDate
        ? new Date(
            `${stage.startDate}T00:00:00Z`
          )
        : new Date(
            "2026-01-10T00:00:00Z"
          );


    rounds.forEach((matches, roundIndex) => {
      const roundNumber = roundIndex + 1;

      const dateValue = new Date(start);

      dateValue.setUTCDate(
        dateValue.getUTCDate() +
        roundIndex * 7
      );

      const date = dateValue
        .toISOString()
        .slice(0, 10);


      const roundId = Number(
        insertRound
          .run(
            stage.stageId,
            roundNumber,
            `Rodada ${roundNumber}`,
            date,
            date
          )
          .lastInsertRowid
      );


      matches.forEach((match, matchIndex) => {
        const stadium = db
          .prepare(
            "SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1"
          )
          .get(match.home) as {
            id: number;
          } | undefined;


        const scheduledAt =
          `${date}T${String(16 + matchIndex * 2)
            .padStart(2, "0")}:00:00`;


        const seed =
          (
            (stage.year * 100000) +
            (roundNumber * 100) +
            matchIndex +
            1
          ) >>> 0;


        insertFixture.run(
          roundId,
          match.home,
          match.away,
          stadium?.id ?? null,
          scheduledAt,
          seed
        );
      });
    });
  });


  create();


  return {
    repaired: true,
    rounds: rounds.length,
    fixtures: expectedFixtures,
  };
}