import { masterPath, saveDir } from "../../../client/config.js";
import type { SqliteDatabase } from "../../../db/database.js";
import { SaveManager } from "../../saves/repo/save-manager.js";
import { getManagedClub } from "./club.repository.js";
import { listFixtures } from "./fixture.repository.js";
import { listSquad, getTactics } from "./squad.repository.js";
import { getSeasonStatus } from "../../competitions/repo/competition.repository.js";
import {
  getStandings,
  rebuildStandings,
} from "../../competitions/repo/standings.repository.js";
import { previewLineup, saveLineup } from "./lineup.repository.js";
import { simulateMatch } from "../../matches/service/match-simulation.service.js";
import { scheduleMatchTacticalChange } from "../../matches/engine/tacticalChangeService.js";
import { progressKnockoutStage } from "../../competitions/service/knockout.service.js";
import { finishSeasonIfComplete } from "../../competitions/service/season.service.js";
import { advanceRoundById } from "../../competitions/service/calendar.service.js";
import type {
  CampaignClubDto,
  CampaignOverviewResponse,
  CampaignCalendarResponse,
  CampaignSquadResponse,
  CampaignTeamResponse,
  MatchCenterResponse,
  MatchPreparationResponse,
  MatchFixtureDto,
  MatchLineupPlayerDto,
  SaveMatchLineupRequest,
  MatchTacticalChangeRequest,
  MatchHistorySnapshotDto,
} from "../../../../shared/src/index.js";
import type { CampaignRepository } from "./campaign.repository.js";
import { SaveNotFoundError } from "../../saves/save-not-found.error.js";
type MatchHistorySnapshotData = {
  homeLineup: MatchLineupPlayerDto[];
  awayLineup: MatchLineupPlayerDto[];
  homeTactics: MatchHistorySnapshotDto["homeTactics"];
  awayTactics: MatchHistorySnapshotDto["awayTactics"];
  result: {
    home: MatchCenterResponse["statistics"]["home"];
    away: MatchCenterResponse["statistics"]["away"];
    eventCount: number;
    momentumCount: number;
    homeScore: number;
    awayScore: number;
  };
  engineVersion: string;
  randomSeed: number;
  completedAt: string;
  isLegacy: boolean;
};
export class SqliteCampaignRepository implements CampaignRepository {
  private readonly manager = new SaveManager(masterPath, saveDir);
  scheduleTacticalChange(
    id: string,
    fixtureId: number,
    input: MatchTacticalChangeRequest,
  ): { changeId: number } {
    return this.withSave(id, (db) => {
      const managedClub = getManagedClub(db);
      const { minute, type, ...payload } = input;
      const changeId = scheduleMatchTacticalChange(
        db,
        fixtureId,
        managedClub.id,
        minute,
        type,
        payload,
      );
      return { changeId };
    });
  }
  private withSave<T>(id: string, query: (db: SqliteDatabase) => T): T {
    const save = this.manager.list().find((item) => item.id === id);
    if (!save) throw new SaveNotFoundError(id);
    const db = this.manager.open(save.filePath);
    try {
      return query(db);
    } finally {
      db.close();
    }
  }
  private club(db: SqliteDatabase): CampaignClubDto {
    const managed = getManagedClub(db);
    const extra = db
      .prepare(
        "SELECT c.reputation,city.name AS city,st.name AS stadium,st.capacity AS stadiumCapacity FROM club c LEFT JOIN city ON city.id=c.city_id LEFT JOIN stadium st ON st.club_id=c.id WHERE c.id=? ORDER BY st.id LIMIT 1",
      )
      .get(managed.id) as {
      reputation: number;
      city: string | null;
      stadium: string | null;
      stadiumCapacity: number | null;
    };
    return { ...managed, ...extra };
  }
  private metadata(db: SqliteDatabase) {
    const value = db
      .prepare(
        "SELECT id,name,manager_name AS managerName FROM game_save_metadata LIMIT 1",
      )
      .get() as { id: string; name: string; managerName: string } | undefined;
    if (!value) throw new Error("Campaign metadata is missing.");
    return value;
  }
  overview(id: string): CampaignOverviewResponse {
    return this.withSave(id, (db) => {
      const club = this.club(db),
        fixtures = listFixtures(db).filter(
          (f) => f.homeClub === club.name || f.awayClub === club.name,
        );
      const nextFixture =
        fixtures.find((f) =>
          ["SCHEDULED", "IN_PROGRESS", "POSTPONED"].includes(f.status),
        ) ?? null;
      const recentResult =
        [...fixtures].reverse().find((f) => f.status === "COMPLETED") ?? null;
      const competitions = getSeasonStatus(db)
        .filter((s) =>
          Boolean(
            db
              .prepare(
                "SELECT 1 FROM stage_participant WHERE stage_id=? AND club_id=?",
              )
              .get(s.stageId, club.id),
          ),
        )
        .map((s) => {
          const rows =
            ["LEAGUE", "GROUPS"].includes(s.stageKind) ? getStandings(db, s.stageId, false) : [];
          return {
            competition: s.competition,
            stage: s.stage,
            seasonYear: s.seasonYear,
            stageStatus: s.stageStatus,
            pendingFixtures: s.pendingFixtures,
            completedFixtures: s.completedFixtures,
            stageId: s.stageId,
            standing: rows.map((row, index) => ({
              position: row.position,
              groupId: row.groupId,
              groupName: row.groupName,
              club: row.club,
              played: row.played,
              wins: row.wins,
              draws: row.draws,
              losses: row.losses,
              goalsFor: row.goalsFor,
              goalsAgainst: row.goalsAgainst,
              goalDifference: row.goalDifference,
              points: row.points,
              isManaged: row.clubId === club.id,
            })),
          };
        });
      return {
        save: this.metadata(db),
        club,
        nextFixture,
        recentResult,
        competitions,
        squadSize: listSquad(db, club.id).length,
      };
    });
  }
  calendar(id: string): CampaignCalendarResponse {
    return this.withSave(id, (db) => {
      const club = getManagedClub(db);
      return {
        fixtures: listFixtures(db).filter(
          (f) => f.homeClub === club.name || f.awayClub === club.name,
        ),
      };
    });
  }
  squad(id: string): CampaignSquadResponse {
    return this.withSave(id, (db) => {
      const club = this.club(db);
      return { club, players: listSquad(db, club.id) };
    });
  }
  team(id: string): CampaignTeamResponse {
    return this.withSave(id, (db) => {
      const club = this.club(db),
        tactics = getTactics(db, club.id);
      const exists = Boolean(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='club_finance'",
          )
          .get(),
      );
      const finances = exists
        ? (db
            .prepare(
              "SELECT f.balance,f.transfer_budget AS transferBudget,f.weekly_wage_budget AS weeklyWageBudget,COALESCE((SELECT SUM(pc.weekly_wage) FROM player_contract pc WHERE pc.club_id=c.id AND pc.status='ACTIVE'),0) AS wageBillWeekly,(SELECT COUNT(*) FROM squad_membership sm WHERE sm.club_id=c.id) AS squadSize FROM club c JOIN club_finance f ON f.club_id=c.id WHERE c.id=?",
            )
            .get(club.id) as CampaignTeamResponse["finances"])
        : null;
      return { club, tactics, finances };
    });
  }
  private fixture(db: SqliteDatabase, fixtureId: number): MatchFixtureDto {
    const row = db
      .prepare(
        `
   SELECT f.id,co.name AS competition,st.name AS stage,r.name AS round,
    f.scheduled_at AS scheduledAt,f.status,f.current_minute AS currentMinute,
    f.home_club_id AS homeId,home.name AS homeName,f.away_club_id AS awayId,away.name AS awayName,
    f.home_score AS homeScore,f.away_score AS awayScore,
    f.home_penalties AS homePenalties,f.away_penalties AS awayPenalties
   FROM fixture f JOIN competition_round r ON r.id=f.round_id
   JOIN competition_stage st ON st.id=r.stage_id
   JOIN competition_season cs ON cs.id=st.season_id
   JOIN competition co ON co.id=cs.competition_id
   JOIN club home ON home.id=f.home_club_id JOIN club away ON away.id=f.away_club_id
   WHERE f.id=?
  `,
      )
      .get(fixtureId) as
      | {
          id: number;
          competition: string;
          stage: string;
          round: string;
          scheduledAt: string | null;
          status: MatchFixtureDto["status"];
          currentMinute: number;
          homeId: number;
          homeName: string;
          awayId: number;
          awayName: string;
          homeScore: number | null;
          awayScore: number | null;
          homePenalties: number | null;
          awayPenalties: number | null;
        }
      | undefined;
    if (!row) throw new Error(`Fixture ${fixtureId} not found.`);
    return {
      id: row.id,
      competition: row.competition,
      stage: row.stage,
      round: row.round,
      scheduledAt: row.scheduledAt,
      status: row.status,
      currentMinute: row.currentMinute ?? 0,
      home: { clubId: row.homeId, name: row.homeName },
      away: { clubId: row.awayId, name: row.awayName },
      score: {
        home: row.homeScore ?? 0,
        away: row.awayScore ?? 0,
        homePenalties: row.homePenalties,
        awayPenalties: row.awayPenalties,
      },
    };
  }
  private lineup(
    db: SqliteDatabase,
    fixtureId: number,
    clubId: number,
  ): MatchLineupPlayerDto[] {
    const saved = db
      .prepare(
        `
   SELECT ml.player_id AS playerId,pe.full_name AS name,ml.position_code AS position,
    ml.slot_number AS slot,ml.is_starting AS isStarting,
    COALESCE(pc.energy,100) AS energy,COALESCE(pc.morale,50) AS morale,COALESCE(pc.sharpness,50) AS sharpness
   FROM match_lineup ml JOIN person pe ON pe.id=ml.player_id
   LEFT JOIN player_condition pc ON pc.player_id=ml.player_id
   WHERE ml.fixture_id=? AND ml.club_id=? ORDER BY ml.is_starting DESC,ml.slot_number
  `,
      )
      .all(fixtureId, clubId) as Array<{
      playerId: number;
      name: string;
      position: string;
      slot: number;
      isStarting: number;
      energy: number;
      morale: number;
      sharpness: number;
    }>;
    if (saved.length)
      return saved.map((p) => ({ ...p, isStarting: p.isStarting === 1 }));
    const preview = previewLineup(db, clubId, fixtureId);
    return [...preview.starters, ...preview.bench].map((p) => ({
      playerId: p.playerId,
      name: p.name,
      position: p.position,
      slot: p.slot,
      isStarting: p.isStarting,
      energy: p.energy,
      morale: p.morale,
      sharpness: p.sharpness,
    }));
  }
  matchPreparation(id: string, fixtureId: number): MatchPreparationResponse {
    return this.withSave(id, (db) => {
      const fixture = this.fixture(db, fixtureId);
      if (!["SCHEDULED", "IN_PROGRESS"].includes(fixture.status))
        throw new Error("This fixture is no longer available for preparation.");
      const managedClubId = getManagedClub(db).id;
      return {
        fixture,
        managedClubId,
        homeLineup: this.lineup(db, fixtureId, fixture.home.clubId),
        awayLineup: this.lineup(db, fixtureId, fixture.away.clubId),
        managedClubIsHome: managedClubId === fixture.home.clubId,
      };
    });
  }
  saveMatchLineup(
    id: string,
    fixtureId: number,
    input: SaveMatchLineupRequest,
  ): MatchPreparationResponse {
    return this.withSave(id, (db) => {
      const managedClubId = getManagedClub(db).id;
      saveLineup(
        db,
        fixtureId,
        managedClubId,
        input.starterIds,
        input.benchIds,
      );
      const fixture = this.fixture(db, fixtureId);
      return {
        fixture,
        managedClubId,
        homeLineup: this.lineup(db, fixtureId, fixture.home.clubId),
        awayLineup: this.lineup(db, fixtureId, fixture.away.clubId),
        managedClubIsHome: managedClubId === fixture.home.clubId,
      };
    });
  }
  matchCenter(id: string, fixtureId: number): MatchCenterResponse {
    return this.withSave(id, (db) => this.matchCenterFromDb(db, fixtureId));
  }
  advanceMatch(
    id: string,
    fixtureId: number,
    throughMinute: number,
  ): MatchCenterResponse {
    return this.withSave(id, (db) => {
      const fixture = this.fixture(db, fixtureId);
      if (fixture.status === "COMPLETED")
        return this.matchCenterFromDb(db, fixtureId);
      const summary = simulateMatch(db, fixtureId, throughMinute);
      if (summary.minutes === 90) {
        // The timeline contains every actual substitution in chronological order.
        // Persist its last active XI to the match-specific lineup snapshot.
        const changes = db
          .prepare(
            "SELECT club_id AS clubId,player_id AS playerId,secondary_player_id AS secondaryPlayerId,minute FROM match_event WHERE fixture_id=? AND event_type='SUBSTITUTION' AND secondary_player_id IS NOT NULL ORDER BY minute,id",
          )
          .all(fixtureId) as Array<{
          clubId: number;
          playerId: number;
          secondaryPlayerId: number;
        }>;
        const lineupUpdate = db.transaction(() => {
          const read = db.prepare(
            "SELECT slot_number AS slot,position_code AS role FROM match_lineup WHERE fixture_id=? AND club_id=? AND player_id=?",
          );
          const benchOutgoing = db.prepare(
            "UPDATE match_lineup SET is_starting=0,slot_number=COALESCE((SELECT MAX(other.slot_number)+1 FROM match_lineup other WHERE other.fixture_id=? AND other.club_id=? AND other.is_starting=0),12),position_code='BENCH' WHERE fixture_id=? AND club_id=? AND player_id=?",
          );
          const benchIncoming = db.prepare(
            "UPDATE match_lineup SET is_starting=1,slot_number=?,position_code=? WHERE fixture_id=? AND club_id=? AND player_id=?",
          );
          for (const event of changes) {
            const outgoing = read.get(
              fixtureId,
              event.clubId,
              event.playerId,
            ) as { slot: number; role: string } | undefined;
            if (!outgoing) continue;
            benchOutgoing.run(
              fixtureId,
              event.clubId,
              fixtureId,
              event.clubId,
              event.playerId,
            );
            benchIncoming.run(
              outgoing.slot,
              outgoing.role,
              fixtureId,
              event.clubId,
              event.secondaryPlayerId,
            );
          }
        });
        lineupUpdate.immediate();
        const stage = db
          .prepare(
            "SELECT r.stage_id AS stageId,r.id AS roundId FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE f.id=?",
          )
          .get(fixtureId) as { stageId: number; roundId: number };
        const pendingFixtures = db
          .prepare(
            "SELECT COUNT(*) AS count FROM fixture WHERE round_id=? AND status IN ('SCHEDULED','IN_PROGRESS')",
          )
          .get(stage.roundId) as { count: number };
        if (pendingFixtures.count > 0) {
          // The managed match stays interactive; only after its full-time do we
          // resolve the rest of the same round in batch and finalize standings once.
          advanceRoundById(db, stage.roundId, stage.stageId);
        } else {
          const unfinished = db
            .prepare(
              "SELECT COUNT(*) AS count FROM fixture WHERE round_id=? AND status<>'COMPLETED'",
            )
            .get(stage.roundId) as { count: number };
          if (unfinished.count === 0) {
            const finalize = db.transaction(() => {
              progressKnockoutStage(db, stage.stageId, stage.roundId);
              rebuildStandings(db, stage.stageId);
              finishSeasonIfComplete(db, stage.stageId);
            });
            finalize.immediate();
          }
        }
      }
      return this.matchCenterFromDb(db, fixtureId);
    });
  }

  competition(id: string, stageId: number): CampaignCompetitionDetailResponse {
    return this.withSave(id, (db) => {
      const stage = getSeasonStatus(db, stageId)[0];
      if (!stage) throw new Error(`Competition stage ${stageId} was not found.`);
      const standings = ["LEAGUE", "GROUPS"].includes(stage.stageKind) ? getStandings(db, stageId) : [];
      const rounds = db.prepare(`
        SELECT r.id AS roundId, r.round_number AS roundNumber, r.name,
          COUNT(f.id) AS fixtureCount,
          SUM(CASE WHEN f.status='COMPLETED' THEN 1 ELSE 0 END) AS completedCount
        FROM competition_round r
        LEFT JOIN fixture f ON f.round_id=r.id
        WHERE r.stage_id=?
        GROUP BY r.id ORDER BY r.round_number
      `).all(stageId) as Array<{roundId:number;roundNumber:number;name:string;fixtureCount:number;completedCount:number|null}>;
      const fixtures = db.prepare(`
        SELECT f.id, r.round_number AS roundNumber, r.name AS roundName,
          f.scheduled_at AS scheduledAt, f.status,
          f.home_score AS homeScore, f.away_score AS awayScore,
          home.name AS homeClub, away.name AS awayClub
        FROM fixture f JOIN competition_round r ON r.id=f.round_id
        JOIN club home ON home.id=f.home_club_id JOIN club away ON away.id=f.away_club_id
        WHERE r.stage_id=? ORDER BY r.round_number, f.scheduled_at, f.id
      `).all(stageId) as Array<{id:number;roundNumber:number;roundName:string;scheduledAt:string|null;status:CampaignCompetitionFixtureDto["status"];homeScore:number|null;awayScore:number|null;homeClub:string;awayClub:string}>;
      const scorers = db.prepare(`
        SELECT
          e.player_id AS playerId,
          p.full_name AS player,
          (
            SELECT GROUP_CONCAT(club_name, ', ')
            FROM (
              SELECT DISTINCT c2.name AS club_name
              FROM match_event e2
              JOIN fixture f2 ON f2.id = e2.fixture_id
              JOIN competition_round r2 ON r2.id = f2.round_id
              JOIN competition_stage st2 ON st2.id = r2.stage_id
              JOIN club c2 ON c2.id = e2.club_id
              WHERE e2.player_id = e.player_id
                AND st2.season_id = ?
                AND f2.status = 'COMPLETED'
                AND e2.event_type IN ('GOAL', 'PENALTY_GOAL')
                AND e2.club_id IS NOT NULL
              ORDER BY c2.name COLLATE NOCASE
            )
          ) AS clubs,
          COUNT(*) AS goals
        FROM match_event e
        JOIN fixture f ON f.id = e.fixture_id
        JOIN competition_round r ON r.id = f.round_id
        JOIN competition_stage st ON st.id = r.stage_id
        JOIN person p ON p.id = e.player_id
        WHERE st.season_id = ?
          AND f.status = 'COMPLETED'
          AND e.event_type IN ('GOAL', 'PENALTY_GOAL')
          AND e.player_id IS NOT NULL
          AND e.club_id IS NOT NULL
        GROUP BY e.player_id, p.full_name
        ORDER BY goals DESC, player COLLATE NOCASE, playerId
        LIMIT 50
      `).all(stage.seasonId, stage.seasonId) as Array<{playerId:number;player:string;clubs:string;goals:number}>;
      return {
        stage: {stageId:stage.stageId,competition:stage.competition,stage:stage.stage,seasonYear:stage.seasonYear,stageKind:stage.stageKind,stageStatus:stage.stageStatus},
        standings: standings.map((row)=>({position:row.position,groupId:row.groupId,groupName:row.groupName,clubId:row.clubId,club:row.club,played:row.played,wins:row.wins,draws:row.draws,losses:row.losses,goalsFor:row.goalsFor,goalsAgainst:row.goalsAgainst,goalDifference:row.goalDifference,points:row.points})),
        rounds: rounds.map(round=>({...round,completedCount:round.completedCount??0,fixtures:fixtures.filter(f=>f.roundNumber===round.roundNumber).map(f=>({id:f.id,round:f.roundName,scheduledAt:f.scheduledAt,status:f.status,homeClub:f.homeClub,awayClub:f.awayClub,score:f.status==="COMPLETED"?`${f.homeScore ?? 0}–${f.awayScore ?? 0}`:null}))})),
        topScorers: scorers,
      };
    });
  }

  matchHistory(id: string, fixtureId: number): MatchCenterResponse {
    return this.withSave(id, (db) => {
      const fixture = this.fixture(db, fixtureId);
      if (fixture.status !== "COMPLETED")
        throw new Error("Match history is only available after full-time.");
      const row = db
        .prepare(
          "SELECT home_lineup_json AS homeLineupJson,away_lineup_json AS awayLineupJson,tactics_json AS tacticsJson,result_json AS resultJson,engine_version AS engineVersion,random_seed AS randomSeed,is_legacy AS isLegacy,completed_at AS completedAt FROM match_history_snapshot WHERE fixture_id=?",
        )
        .get(fixtureId) as
        | {
            homeLineupJson: string;
            awayLineupJson: string;
            tacticsJson: string;
            resultJson: string | null;
            engineVersion: string;
            randomSeed: number;
            isLegacy: number;
            completedAt: string | null;
          }
        | undefined;
      if (!row || !row.resultJson || !row.completedAt)
        throw new Error(
          "This completed match predates historical snapshots and cannot be reconstructed accurately.",
        );
      const tactics = JSON.parse(row.tacticsJson) as {
        home: MatchHistorySnapshotData["homeTactics"];
        away: MatchHistorySnapshotData["awayTactics"];
      };
      const result = JSON.parse(row.resultJson) as {
        home: MatchCenterResponse["statistics"]["home"];
        away: MatchCenterResponse["statistics"]["away"];
        eventCount: number;
        momentumCount: number;
        homeScore: number;
        awayScore: number;
      };
      const persistedEventCount = (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=?",
          )
          .get(fixtureId) as { count: number }
      ).count;
      const persistedMomentumCount = (
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM match_momentum WHERE fixture_id=?",
          )
          .get(fixtureId) as { count: number }
      ).count;
      const hasFullTime = Boolean(
        db
          .prepare(
            "SELECT 1 FROM match_event WHERE fixture_id=? AND event_type='FULL_TIME'",
          )
          .get(fixtureId),
      );
      if (
        result.momentumCount !== 90 ||
        persistedMomentumCount !== result.momentumCount ||
        persistedEventCount !== result.eventCount ||
        !hasFullTime
      )
        throw new Error("Match history is incomplete and cannot be displayed.");
      return this.matchCenterFromDb(db, fixtureId, {
        homeLineup: JSON.parse(row.homeLineupJson) as MatchLineupPlayerDto[],
        awayLineup: JSON.parse(row.awayLineupJson) as MatchLineupPlayerDto[],
        homeTactics: tactics.home,
        awayTactics: tactics.away,
        result,
        engineVersion: row.engineVersion,
        randomSeed: row.randomSeed,
        completedAt: row.completedAt,
        isLegacy: row.isLegacy === 1,
      });
    });
  }
  private matchCenterFromDb(
    db: SqliteDatabase,
    fixtureId: number,
    history?: MatchHistorySnapshotData,
  ): MatchCenterResponse {
    const fixture = this.fixture(db, fixtureId);
    if (history) {
      fixture.home.name = history.homeTactics.clubName;
      fixture.away.name = history.awayTactics.clubName;
    }
    const rows = db
      .prepare(
        "SELECT id,minute,added_time AS addedTime,club_id AS clubId,player_id AS playerId,secondary_player_id AS secondaryPlayerId,event_type AS type,xg,description FROM match_event WHERE fixture_id=? ORDER BY minute,added_time,id",
      )
      .all(fixtureId) as Array<{
      id: number;
      minute: number;
      addedTime: number;
      clubId: number | null;
      playerId: number | null;
      secondaryPlayerId: number | null;
      type: MatchCenterResponse["events"][number]["type"];
      xg: number | null;
      description: string | null;
    }>;
    const pendingDecisions = db
      .prepare(
        "SELECT id,minute,change_type AS type,payload FROM match_tactical_change WHERE fixture_id=? AND applied=0 ORDER BY minute,id",
      )
      .all(fixtureId) as Array<{
      id: number;
      minute: number;
      type: string;
      payload: string;
    }>;
    const decisionEvents = pendingDecisions.map((decision) => {
      const payload = JSON.parse(decision.payload) as Record<string, unknown>;
      let description = "Manager decision scheduled";
      if (decision.type === "MENTALITY")
        description = `Mentality changed to ${String(payload.mentality).replaceAll("_", " ").toLowerCase()}`;
      if (decision.type === "INSTRUCTION")
        description = `Instruction ${String(payload.key).replaceAll("_", " ")} set to ${String(payload.value)}`;
      if (decision.type === "SUBSTITUTION")
        description = `Substitution scheduled: player #${String(payload.playerOutId)} off, player #${String(payload.playerInId)} on`;
      if (decision.type === "FORMATION")
        description = `Formation change scheduled (ID ${String(payload.formationId)})`;
      return {
        id: -decision.id,
        fixtureId,
        minute: decision.minute,
        addedTime: 0,
        type: "TACTIC_CHANGE" as const,
        clubId: getManagedClub(db).id,
        playerId: null,
        secondaryPlayerId: null,
        xg: 0,
        description,
      };
    });
    const events = [
      ...rows.map((e) => ({
        id: e.id,
        fixtureId,
        minute: e.minute,
        addedTime: e.addedTime,
        type: e.type,
        clubId: e.clubId,
        playerId: e.playerId,
        secondaryPlayerId: e.secondaryPlayerId,
        xg: e.xg,
        description: e.description,
      })),
      ...decisionEvents,
    ].sort((a, b) => a.minute - b.minute || a.id - b.id);
    const momentumRows = db
      .prepare(
        `
   SELECT minute,home_pressure AS homePressure,away_pressure AS awayPressure,
    home_score AS homeScore,away_score AS awayScore,
    home_territorial_control AS homeTerritorialControl,away_territorial_control AS awayTerritorialControl,
    home_offensive_threat AS homeOffensiveThreat,away_offensive_threat AS awayOffensiveThreat,
    home_defensive_stability AS homeDefensiveStability,away_defensive_stability AS awayDefensiveStability,
    home_intensity AS homeIntensity,away_intensity AS awayIntensity,
    home_physical_condition AS homePhysicalCondition,away_physical_condition AS awayPhysicalCondition
   FROM match_momentum WHERE fixture_id=? ORDER BY minute
  `,
      )
      .all(fixtureId) as Array<Record<string, number>>;
    const debugRows = db
      .prepare(
        "SELECT minute,trace_json AS traceJson FROM match_momentum_debug WHERE fixture_id=? ORDER BY minute",
      )
      .all(fixtureId) as Array<{ minute: number; traceJson: string }>;
    const debugByMinute = new Map(
      debugRows.map((row) => [
        row.minute,
        JSON.parse(row.traceJson) as NonNullable<
          MatchCenterResponse["momentum"][number]["debugTrace"]
        >,
      ]),
    );
    const momentum: MatchCenterResponse["momentum"] = momentumRows.map(
      (point) => ({
        minute: point.minute!,
        homePressure: point.homePressure!,
        awayPressure: point.awayPressure!,
        homeScore: point.homeScore!,
        awayScore: point.awayScore!,
        homeState: {
          territorialControl: point.homeTerritorialControl!,
          offensiveThreat: point.homeOffensiveThreat!,
          defensiveStability: point.homeDefensiveStability!,
          intensity: point.homeIntensity!,
          physicalCondition: point.homePhysicalCondition!,
          momentum: point.homePressure!,
        },
        awayState: {
          territorialControl: point.awayTerritorialControl!,
          offensiveThreat: point.awayOffensiveThreat!,
          defensiveStability: point.awayDefensiveStability!,
          intensity: point.awayIntensity!,
          physicalCondition: point.awayPhysicalCondition!,
          momentum: point.awayPressure!,
        },
        ...(debugByMinute.has(point.minute!)
          ? { debugTrace: debugByMinute.get(point.minute!)! }
          : {}),
      }),
    );
    const aggregate = (clubId: number) => {
      const count = (types: string[]) =>
        rows.filter((e) => e.clubId === clubId && types.includes(e.type))
          .length;
      return {
        shots: count(["GOAL", "SAVE", "MISS"]),
        shotsOnTarget: count(["GOAL", "SAVE"]),
        goals: count(["GOAL"]),
        expectedGoals: rows
          .filter(
            (e) =>
              e.clubId === clubId && ["GOAL", "SAVE", "MISS"].includes(e.type),
          )
          .reduce((sum, e) => sum + (e.xg ?? 0), 0),
        fouls: count(["FOUL"]),
        yellowCards: count(["YELLOW_CARD"]),
        redCards: count(["RED_CARD"]),
        substitutions: count(["SUBSTITUTION"]),
        injuries: count(["INJURY"]),
      };
    };
    const playerStats = db
      .prepare(
        "SELECT player_id AS playerId,club_id AS clubId,energy,rating,minutes_played AS minutesPlayed,goals,assists,yellow_cards AS yellowCards,red_card AS redCard,substituted_out AS substitutedOut FROM match_player_state WHERE fixture_id=? ORDER BY club_id,minutes_played DESC,player_id",
      )
      .all(fixtureId) as Array<{
      playerId: number;
      clubId: number;
      energy: number;
      rating: number;
      minutesPlayed: number;
      goals: number;
      assists: number;
      yellowCards: number;
      redCard: number;
      substitutedOut: number;
    }>;
    const formations = history
      ? []
      : (db
          .prepare("SELECT id,name FROM formation ORDER BY name")
          .all() as Array<{ id: number; name: string }>);
    return {
      fixture,
      managedClubId: getManagedClub(db).id,
      formations,
      playbackStatus:
        fixture.status === "COMPLETED"
          ? "FINISHED"
          : fixture.status === "IN_PROGRESS"
            ? "PAUSED"
            : "IDLE",
      teams: [
        {
          clubId: fixture.home.clubId,
          name: fixture.home.name,
          isHome: true,
          lineup: history
            ? history.homeLineup
            : this.lineup(db, fixtureId, fixture.home.clubId),
        },
        {
          clubId: fixture.away.clubId,
          name: fixture.away.name,
          isHome: false,
          lineup: history
            ? history.awayLineup
            : this.lineup(db, fixtureId, fixture.away.clubId),
        },
      ],
      statistics: history
        ? { home: history.result.home, away: history.result.away }
        : {
            home: aggregate(fixture.home.clubId),
            away: aggregate(fixture.away.clubId),
          },
      playerStats: playerStats.map((player) => ({
        ...player,
        redCard: player.redCard === 1,
        substitutedOut: player.substitutedOut === 1,
      })),
      events,
      momentum,
      ...(history
        ? {
            history: {
              engineVersion: history.engineVersion,
              randomSeed: history.randomSeed,
              completedAt: history.completedAt,
              isLegacy: history.isLegacy,
              homeTactics: history.homeTactics,
              awayTactics: history.awayTactics,
            },
          }
        : {}),
    };
  }
}
