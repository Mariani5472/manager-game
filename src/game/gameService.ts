import type { SqliteDatabase } from "../db/database.js";
import { simulateMatch, type MatchSummary } from "./matchEngine.js";
import { applyRosterSeason } from "./rosterLifecycle.js";

export interface FixtureInfo {
  id: number; competition: string; stage: string; round: string; scheduledAt: string | null;
  homeClub: string; awayClub: string; status: string; score: string | null; winnerClub: string | null;
}
export interface ClubSummary { id: number; name: string; nation: string; isManaged: boolean; }
export interface PlayerSummary {
  id: number; name: string; shirtNumber: number | null; squadStatus: string; positions: string[];
  energy: number; morale: number; sharpness: number;
}
export interface TacticSummary {
  formation: string; mentality: string; pressing: number; tempo: number;
  defensiveLine: number; width: number; passingDirectness: number; counterAttack: boolean;
}
export interface StandingRow {
  stageId: number; groupId: number; clubId: number; club: string; played: number; wins: number;
  draws: number; losses: number; goalsFor: number; goalsAgainst: number; goalDifference: number;
  points: number; fairPlayPoints: number;
}
export interface SeasonSummary {
  seasonId: number; competition: string; seasonYear: number; seasonStatus: string; stageId: number;
  stage: string; stageKind: string; stageStatus: "IN_PROGRESS" | "COMPLETED";
  pendingFixtures: number; completedFixtures: number;
}
interface StageRow {
  stage_id: number; season_id: number; competition_id: number; competition: string;
  season_year: number; season_status: string; stage: string; stage_kind: string;
}
interface ParticipantRow { club_id: number; group_id: number; seed: number | null; }

export function listClubs(db: SqliteDatabase): Array<{ id: number; name: string; nation: string }> {
  return db.prepare(`
    SELECT c.id, c.name, n.name AS nation FROM club c JOIN nation n ON n.id = c.nation_id
    ORDER BY c.reputation DESC, c.name
  `).all() as Array<{ id: number; name: string; nation: string }>;
}

export function getManagedClub(db: SqliteDatabase): ClubSummary {
  const metadata = db.prepare("SELECT selected_club_id AS clubId FROM game_save_metadata LIMIT 1")
    .get() as { clubId: number } | undefined;
  if (!metadata) throw new Error("Campaign metadata is missing.");
  const club = db.prepare(`
    SELECT c.id, c.name, n.name AS nation FROM club c JOIN nation n ON n.id = c.nation_id WHERE c.id = ?
  `).get(metadata.clubId) as Omit<ClubSummary, "isManaged"> | undefined;
  if (!club) throw new Error(`Managed club ${metadata.clubId} is missing from this save.`);
  return { ...club, isManaged: true };
}

export function listSquad(db: SqliteDatabase, clubId: number): PlayerSummary[] {
  const rows = db.prepare(`
    SELECT p.id AS id, p.full_name AS name, sm.shirt_number AS shirtNumber,
      sm.squad_status AS squadStatus,
      COALESCE((SELECT json_group_array(pp.position_code) FROM player_position pp WHERE pp.player_id=p.id),'[]') AS positionsJson,
      COALESCE(pc.energy,100) AS energy, COALESCE(pc.morale,50) AS morale,
      COALESCE(pc.sharpness,50) AS sharpness
    FROM squad_membership sm JOIN person p ON p.id=sm.player_id
    LEFT JOIN player_condition pc ON pc.player_id=p.id WHERE sm.club_id=?
    ORDER BY CASE sm.squad_status WHEN 'FIRST_TEAM' THEN 0 WHEN 'RESERVE' THEN 1 ELSE 2 END,
             sm.shirt_number, p.full_name
  `).all(clubId) as Array<{
    id:number; name:string; shirtNumber:number|null; squadStatus:string; positionsJson:string;
    energy:number; morale:number; sharpness:number;
  }>;
  return rows.map(({positionsJson,...row}) => ({...row, positions: JSON.parse(positionsJson) as string[]}));
}

export function getTactics(db: SqliteDatabase, clubId: number): TacticSummary {
  const row = db.prepare(`
    SELECT f.name AS formation, tt.mentality, tt.pressing, tt.tempo,
      tt.defensive_line AS defensiveLine, tt.width, tt.passing_directness AS passingDirectness,
      tt.counter_attack AS counterAttack
    FROM team_tactic tt JOIN formation f ON f.id=tt.formation_id WHERE tt.club_id=?
  `).get(clubId) as Omit<TacticSummary,"counterAttack"> & {counterAttack:number} | undefined;
  if (!row) throw new Error(`Tactics for club ${clubId} were not found.`);
  return {...row, counterAttack: row.counterAttack === 1};
}

export function listFixtures(db: SqliteDatabase, pendingOnly = false): FixtureInfo[] {
  const statusFilter = pendingOnly ? "WHERE f.status = 'SCHEDULED'" : "";
  return db.prepare(`
    SELECT f.id, co.name AS competition, st.name AS stage, r.name AS round,
      f.scheduled_at AS scheduledAt, home.name AS homeClub, away.name AS awayClub, f.status,
      CASE WHEN f.home_score IS NULL OR f.away_score IS NULL THEN NULL
           WHEN f.home_score=f.away_score AND f.home_penalties IS NOT NULL AND f.away_penalties IS NOT NULL
             THEN f.home_score || ' - ' || f.away_score || ' (Pênaltis ' || f.home_penalties || ' - ' || f.away_penalties || ')'
           ELSE f.home_score || ' - ' || f.away_score END AS score,
      CASE
        WHEN f.home_score IS NULL OR f.away_score IS NULL THEN NULL
        WHEN f.home_score>f.away_score THEN home.name
        WHEN f.away_score>f.home_score THEN away.name
        WHEN f.home_penalties>f.away_penalties THEN home.name
        WHEN f.away_penalties>f.home_penalties THEN away.name
        ELSE NULL
      END AS winnerClub
    FROM fixture f JOIN competition_round r ON r.id=f.round_id
    JOIN competition_stage st ON st.id=r.stage_id
    JOIN competition_season cs ON cs.id=st.season_id JOIN competition co ON co.id=cs.competition_id
    JOIN club home ON home.id=f.home_club_id JOIN club away ON away.id=f.away_club_id
    ${statusFilter} ORDER BY f.scheduled_at, f.id
  `).all() as FixtureInfo[];
}

function getStage(db: SqliteDatabase, stageId: number): StageRow {
  const row = db.prepare(`
    SELECT st.id AS stage_id, st.season_id, cs.competition_id, co.name AS competition,
      cs.season_year, cs.status AS season_status, st.name AS stage, st.stage_kind
    FROM competition_stage st JOIN competition_season cs ON cs.id=st.season_id
    JOIN competition co ON co.id=cs.competition_id WHERE st.id=?
  `).get(stageId) as StageRow | undefined;
  if (!row) throw new Error(`Stage ${stageId} was not found.`);
  return row;
}

export function getSeasonStatus(db: SqliteDatabase, stageId?: number): SeasonSummary[] {
  const query = `
    SELECT st.id AS stage_id, st.season_id, cs.competition_id, co.name AS competition,
      cs.season_year, cs.status AS season_status, st.name AS stage, st.stage_kind
    FROM competition_stage st JOIN competition_season cs ON cs.id=st.season_id
    JOIN competition co ON co.id=cs.competition_id ${stageId === undefined ? "" : "WHERE st.id=?"}
    ORDER BY cs.season_year, co.name, st.stage_order
  `;
  const stages = (stageId === undefined ? db.prepare(query).all() : db.prepare(query).all(stageId)) as StageRow[];
  return stages.map(stage => {
    const counts = db.prepare(`
      SELECT SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status IN ('SCHEDULED','IN_PROGRESS','POSTPONED') THEN 1 ELSE 0 END) AS pending
      FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=?
    `).get(stage.stage_id) as {completed:number|null;pending:number|null};
    const completed = counts.completed ?? 0; const pending = counts.pending ?? 0;
    let knockoutFinalComplete = true;
    if (stage.stage_kind === "KNOCKOUT") {
      const finalRound = db.prepare(`
        SELECT COUNT(f.id) AS total,
          SUM(CASE WHEN f.status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
          SUM(CASE
            WHEN f.home_score<>f.away_score THEN 1
            WHEN f.home_score=f.away_score
              AND f.home_penalties IS NOT NULL AND f.away_penalties IS NOT NULL
              AND f.home_penalties<>f.away_penalties THEN 1
            ELSE 0
          END) AS decided
        FROM competition_round r LEFT JOIN fixture f ON f.round_id=r.id
        WHERE r.stage_id=? AND r.round_number=(
          SELECT MAX(round_number) FROM competition_round WHERE stage_id=?
        )
      `).get(stage.stage_id, stage.stage_id) as {total:number;completed:number|null;decided:number|null};
      // A completed final is not decisive until a draw has persisted unequal
      // penalty scores. A 0-0 without a shootout cannot complete the cup.
      knockoutFinalComplete = finalRound.total === 1 &&
        (finalRound.completed ?? 0) === 1 && (finalRound.decided ?? 0) === 1;
    }
    const stageComplete = pending === 0 && completed > 0 &&
      (stage.stage_kind !== "KNOCKOUT" || knockoutFinalComplete);
    return {
      seasonId:stage.season_id, competition:stage.competition, seasonYear:stage.season_year,
      seasonStatus:stage.season_status, stageId:stage.stage_id, stage:stage.stage,
      stageKind:stage.stage_kind, stageStatus:stageComplete ? "COMPLETED" : "IN_PROGRESS",
      pendingFixtures:pending, completedFixtures:completed,
    };
  });
}

const standingFields: Record<string, keyof StandingRow> = {
  POINTS:"points", WINS:"wins", GOAL_DIFFERENCE:"goalDifference", GOALS_FOR:"goalsFor",
  FAIR_PLAY:"fairPlayPoints", DRAW:"draws",
};

type StandingTieBreak = { points: number; goalDifference: number; goalsFor: number };

export function getStandings(db: SqliteDatabase, stageId: number): StandingRow[] {
  rebuildStandings(db, stageId);
  const rules = db.prepare("SELECT rule_key FROM stage_standing_rule WHERE stage_id=? ORDER BY rule_order")
    .all(stageId) as Array<{rule_key:string}>;
  const rows = db.prepare(`
    SELECT ss.stage_id AS stageId, ss.group_id AS groupId, ss.club_id AS clubId, c.name AS club,
      ss.played, ss.wins, ss.draws, ss.losses, ss.goals_for AS goalsFor,
      ss.goals_against AS goalsAgainst, ss.goals_for-ss.goals_against AS goalDifference,
      ss.points, ss.fair_play_points AS fairPlayPoints
    FROM stage_standing ss JOIN club c ON c.id=ss.club_id WHERE ss.stage_id=?
  `).all(stageId) as StandingRow[];

  // Refine tied groups rule-by-rule. HEAD_TO_HEAD is a mini-table limited to the
  // clubs tied by all earlier rules, avoiding a non-transitive pairwise comparator.
  let groups: StandingRow[][] = [rows];
  for (const {rule_key} of rules) {
    const refined: StandingRow[][] = [];
    for (const group of groups) {
      if (group.length < 2) { refined.push(group); continue; }
      if (rule_key === "HEAD_TO_HEAD") {
        const ids = group.map(row => row.clubId);
        const stats = new Map<number, StandingTieBreak>(ids.map(id => [id, {points:0,goalDifference:0,goalsFor:0}]));
        const fixtures = db.prepare(`
          SELECT f.home_club_id AS home, f.away_club_id AS away,
            f.home_score AS homeScore, f.away_score AS awayScore,
            sf.win_points AS winPoints, sf.draw_points AS drawPoints, sf.loss_points AS lossPoints
          FROM fixture f JOIN competition_round r ON r.id=f.round_id
          LEFT JOIN stage_format sf ON sf.stage_id=r.stage_id
          WHERE r.stage_id=? AND f.status='COMPLETED'
            AND f.home_club_id IN (${ids.map(()=>"?").join(",")})
            AND f.away_club_id IN (${ids.map(()=>"?").join(",")})
        `).all(stageId, ...ids, ...ids) as Array<{home:number;away:number;homeScore:number;awayScore:number;winPoints:number|null;drawPoints:number|null;lossPoints:number|null}>;
        for (const fixture of fixtures) {
          const home = stats.get(fixture.home)!;
          const away = stats.get(fixture.away)!;
          home.goalsFor += fixture.homeScore;
          home.goalDifference += fixture.homeScore - fixture.awayScore;
          away.goalsFor += fixture.awayScore;
          away.goalDifference += fixture.awayScore - fixture.homeScore;
          if (fixture.homeScore > fixture.awayScore) {
            home.points += fixture.winPoints ?? 3; away.points += fixture.lossPoints ?? 0;
          } else if (fixture.homeScore < fixture.awayScore) {
            away.points += fixture.winPoints ?? 3; home.points += fixture.lossPoints ?? 0;
          } else {
            home.points += fixture.drawPoints ?? 1; away.points += fixture.drawPoints ?? 1;
          }
        }
        const compare = (a: StandingRow,b: StandingRow) => {
          const x=stats.get(a.clubId)!; const y=stats.get(b.clubId)!;
          return y.points-x.points || y.goalDifference-x.goalDifference || y.goalsFor-x.goalsFor;
        };
        const sorted = [...group].sort(compare);
        let tie: StandingRow[] = [];
        let previous: StandingTieBreak | undefined;
        for (const row of sorted) {
          const value=stats.get(row.clubId)!;
          if (previous && (value.points!==previous.points || value.goalDifference!==previous.goalDifference || value.goalsFor!==previous.goalsFor)) {
            refined.push(tie); tie=[];
          }
          tie.push(row); previous=value;
        }
        if (tie.length) refined.push(tie);
        continue;
      }
      const field = standingFields[rule_key];
      if (!field) { refined.push(group); continue; }
      const direction = rule_key === "FAIR_PLAY" ? 1 : -1;
      const sorted = [...group].sort((a,b) => direction * (Number(a[field])-Number(b[field])));
      let tie: StandingRow[] = [];
      let previousValue: number | undefined;
      for (const row of sorted) {
        const value = Number(row[field]);
        if (previousValue !== undefined && value !== previousValue) { refined.push(tie); tie=[]; }
        tie.push(row); previousValue=value;
      }
      if (tie.length) refined.push(tie);
    }
    groups = refined;
  }
  return groups.flatMap(group => group.length > 1
    ? [...group].sort((a,b) => a.club.localeCompare(b.club,"pt-BR") || a.clubId-b.clubId)
    : group);
}

function rebuildStandings(db: SqliteDatabase, stageId: number): void {
  getStage(db, stageId);
  const rebuild = db.transaction(() => {
    db.prepare("DELETE FROM stage_standing WHERE stage_id=?").run(stageId);
    db.prepare(`
      INSERT INTO stage_standing (stage_id,club_id,group_id,played,wins,draws,losses,goals_for,goals_against,points,fair_play_points)
      SELECT stage_id,club_id,group_id,0,0,0,0,0,0,0,0 FROM stage_participant WHERE stage_id=?
    `).run(stageId);
    const fixtures = db.prepare(`
      SELECT f.home_club_id AS home,f.away_club_id AS away,f.home_score AS homeScore,
        f.away_score AS awayScore,sf.win_points AS winPoints,sf.draw_points AS drawPoints,sf.loss_points AS lossPoints
      FROM fixture f JOIN competition_round r ON r.id=f.round_id
      LEFT JOIN stage_format sf ON sf.stage_id=r.stage_id
      WHERE r.stage_id=? AND f.status='COMPLETED'
    `).all(stageId) as Array<{
      home:number;away:number;homeScore:number;awayScore:number;
      winPoints:number|null;drawPoints:number|null;lossPoints:number|null;
    }>;
    const update = db.prepare(`
      UPDATE stage_standing SET played=played+1,wins=wins+?,draws=draws+?,losses=losses+?,
        goals_for=goals_for+?,goals_against=goals_against+?,points=points+?
      WHERE stage_id=? AND club_id=?
    `);
    for (const f of fixtures) {
      let hp = f.lossPoints ?? 0, ap = f.lossPoints ?? 0;
      let hw=0,hd=0,hl=0,aw=0,ad=0,al=0;
      if (f.homeScore > f.awayScore) { hp=f.winPoints??3; ap=f.lossPoints??0; hw=1; al=1; }
      else if (f.homeScore < f.awayScore) { ap=f.winPoints??3; hp=f.lossPoints??0; aw=1; hl=1; }
      else { hp=f.drawPoints??1; ap=f.drawPoints??1; hd=1; ad=1; }
      update.run(hw,hd,hl,f.homeScore,f.awayScore,hp,stageId,f.home);
      update.run(aw,ad,al,f.awayScore,f.homeScore,ap,stageId,f.away);
    }
    // Fair-play points are penalty points: one per yellow card and three per red.
    // Lower totals rank ahead. Completed match events are the source of truth.
    db.prepare(`
      UPDATE stage_standing
      SET fair_play_points = COALESCE((
        SELECT SUM(CASE e.event_type WHEN 'YELLOW_CARD' THEN 1 WHEN 'RED_CARD' THEN 3 ELSE 0 END)
        FROM match_event e JOIN fixture f ON f.id=e.fixture_id
        JOIN competition_round r ON r.id=f.round_id
        WHERE r.stage_id=stage_standing.stage_id AND f.status='COMPLETED'
          AND e.club_id=stage_standing.club_id
          AND e.event_type IN ('YELLOW_CARD','RED_CARD')
      ),0)
      WHERE stage_id=?
    `).run(stageId);
  });
  rebuild();
}

function finishSeasonIfComplete(db: SqliteDatabase, stageId: number): void {
  const stage = getStage(db,stageId);
  if (stage.stage_kind !== "LEAGUE" && stage.stage_kind !== "KNOCKOUT") return;
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('SCHEDULED','IN_PROGRESS','POSTPONED') THEN 1 ELSE 0 END) AS pending
    FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=?
  `).get(stageId) as {total:number;completed:number|null;pending:number|null};
  const status = getSeasonStatus(db, stageId)[0];
  const canComplete = counts.total > 0 && (counts.pending ?? 0) === 0 &&
    (stage.stage_kind !== "KNOCKOUT" || status?.stageStatus === "COMPLETED");
  db.prepare("UPDATE competition_season SET status=? WHERE id=?")
    .run(canComplete ? "COMPLETED" : "ACTIVE", stage.season_id);
}

export interface KnockoutFixtureResult {
  fixtureId: number;
  winnerClubId: number;
  homePenalties: number | null;
  awayPenalties: number | null;
}

/** Resolve a completed knockout fixture; tied scores persist a deterministic shootout. */
export function resolveKnockoutFixtureWinner(db: SqliteDatabase, fixtureId: number): KnockoutFixtureResult {
  const fixture = db.prepare(`
    SELECT f.id, f.home_club_id AS home, f.away_club_id AS away,
      f.home_score AS homeScore, f.away_score AS awayScore,
      f.home_penalties AS homePenalties, f.away_penalties AS awayPenalties,
      f.random_seed AS seed, f.status, st.stage_kind AS stageKind
    FROM fixture f JOIN competition_round r ON r.id=f.round_id
    JOIN competition_stage st ON st.id=r.stage_id
    WHERE f.id=?
  `).get(fixtureId) as {
    id:number;home:number;away:number;homeScore:number|null;awayScore:number|null;
    homePenalties:number|null;awayPenalties:number|null;seed:number|null;status:string;stageKind:string;
  }|undefined;
  if (!fixture) throw new Error(`Fixture ${fixtureId} was not found.`);
  if (fixture.stageKind !== "KNOCKOUT") throw new Error(`Fixture ${fixtureId} is not part of a knockout stage.`);
  if (fixture.status !== "COMPLETED" || fixture.homeScore === null || fixture.awayScore === null) {
    throw new Error(`Knockout fixture ${fixtureId} must be completed before its winner can be resolved.`);
  }

  let homePenalties = fixture.homePenalties;
  let awayPenalties = fixture.awayPenalties;
  let winnerClubId: number;
  if (fixture.homeScore !== fixture.awayScore) {
    winnerClubId = fixture.homeScore > fixture.awayScore ? fixture.home : fixture.away;
  } else {
    if (homePenalties === null || awayPenalties === null || homePenalties === awayPenalties) {
      let state = ((fixture.seed ?? fixture.id) ^ (fixture.id * 2654435761)) >>> 0;
      const next = () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 0x100000000;
      };
      homePenalties = 0;
      awayPenalties = 0;
      for (let kick=0; kick<5; kick++) {
        if (next() < 0.76) homePenalties++;
        if (next() < 0.76) awayPenalties++;
      }
      let suddenDeath = 0;
      while (homePenalties === awayPenalties && suddenDeath < 20) {
        const homeScores = next() < 0.76;
        const awayScores = next() < 0.76;
        if (homeScores) homePenalties++;
        if (awayScores) awayPenalties++;
        suddenDeath++;
      }
      if (homePenalties === awayPenalties) homePenalties++;
      db.prepare("UPDATE fixture SET home_penalties=?,away_penalties=? WHERE id=?")
        .run(homePenalties,awayPenalties,fixture.id);
    }
    winnerClubId = homePenalties > awayPenalties ? fixture.home : fixture.away;
  }
  return {fixtureId:fixture.id,winnerClubId,homePenalties,awayPenalties};
}

/** Advance a completed knockout round by creating the next round from its winners. */
function progressKnockoutStage(db: SqliteDatabase, stageId: number, roundId: number): void {
  const stage = getStage(db, stageId);
  if (stage.stage_kind !== "KNOCKOUT") return;

  const round = db.prepare(`
    SELECT id, round_number AS roundNumber, name FROM competition_round WHERE id=? AND stage_id=?
  `).get(roundId, stageId) as {id:number;roundNumber:number;name:string}|undefined;
  if (!round) throw new Error(`Round ${roundId} does not belong to knockout stage ${stageId}.`);

  const roundState = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed
    FROM fixture WHERE round_id=?
  `).get(roundId) as {total:number;completed:number|null};
  if (roundState.total === 0 || (roundState.completed ?? 0) !== roundState.total) return;

  const laterRound = db.prepare(`
    SELECT id FROM competition_round WHERE stage_id=? AND round_number>? LIMIT 1
  `).get(stageId, round.roundNumber);
  if (laterRound) return;

  const matches = db.prepare(`
    SELECT id, scheduled_at AS scheduledAt
    FROM fixture WHERE round_id=? ORDER BY scheduled_at, id
  `).all(roundId) as Array<{id:number;scheduledAt:string|null}>;

  // Winner selection is based on persisted regulation scores and, for a draw,
  // persisted penalty scores. Re-running this resolver never changes a decided tie.
  const winners = matches.map(match => resolveKnockoutFixtureWinner(db,match.id).winnerClubId);

  if (winners.length === 1) return;
  if (winners.length < 2 || winners.length % 2 !== 0) {
    throw new Error(`Knockout stage ${stageId} produced ${winners.length} winners; an even number is required to create the next round.`);
  }

  const nextRoundNumber = round.roundNumber + 1;
  const roundName = winners.length === 2 ? "Final"
    : winners.length === 4 ? "Semifinais"
    : winners.length === 8 ? "Quartas de final"
    : `Rodada eliminatória ${nextRoundNumber}`;
  const scheduledDates = matches.map(match => match.scheduledAt).filter((value): value is string => Boolean(value));
  scheduledDates.sort();
  const lastDate = scheduledDates.length ? scheduledDates[scheduledDates.length - 1] : undefined;
  const baseDate = lastDate ? new Date(lastDate) : new Date();
  baseDate.setUTCDate(baseDate.getUTCDate() + 7);
  const date = baseDate.toISOString().slice(0,10);

  const createNextRound = db.transaction(() => {
    const nextRoundId = db.prepare(`
      INSERT INTO competition_round (stage_id,round_number,name,start_date,end_date) VALUES (?,?,?,?,?)
    `).run(stageId,nextRoundNumber,roundName,date,date).lastInsertRowid as number;
    const insertFixture = db.prepare(`
      INSERT INTO fixture (round_id,home_club_id,away_club_id,stadium_id,scheduled_at,random_seed)
      VALUES (?,?,?,?,?,?)
    `);
    winners.forEach((winner, index) => {
      if (index % 2 !== 0) return;
      const home = winner;
      const away = winners[index+1]!;
      const stadium = db.prepare("SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1")
        .get(home) as {id:number}|undefined;
      const time = `${date}T${String(16+(index/2%2)*2).padStart(2,"0")}:00:00`;
      const seed = ((stage.season_year * 100000) + (nextRoundNumber * 100) + index + 1) >>> 0;
      insertFixture.run(nextRoundId,home,away,stadium?.id??null,time,seed);
    });
    db.prepare("UPDATE competition_season SET status='ACTIVE' WHERE id=?").run(stage.season_id);
  });
  createNextRound();
}

export function advanceNextFixture(db: SqliteDatabase, fixtureId?: number): MatchSummary {
  const row = fixtureId
    ? db.prepare("SELECT id FROM fixture WHERE id=? AND status IN ('SCHEDULED','IN_PROGRESS')").get(fixtureId) as {id:number}|undefined
    : db.prepare("SELECT id FROM fixture WHERE status IN ('SCHEDULED','IN_PROGRESS') ORDER BY CASE status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END,scheduled_at,id LIMIT 1").get() as {id:number}|undefined;
  if (!row) throw new Error(fixtureId ? `Scheduled fixture ${fixtureId} not found (it may already be completed or is not playable).` : "No scheduled or in-progress fixtures remain.");
  const stage = db.prepare("SELECT r.stage_id AS id, r.id AS roundId FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE f.id=?")
    .get(row.id) as {id:number;roundId:number}|undefined;
  if (!stage) throw new Error(`Fixture ${row.id} has no competition stage.`);
  // simulateMatch commits a checkpoint after every minute. Do not wrap it in an
  // outer transaction, otherwise SQLite would defer every checkpoint until FT.
  const summary = simulateMatch(db,row.id);
  progressKnockoutStage(db, stage.id, stage.roundId);
  rebuildStandings(db,stage.id);
  finishSeasonIfComplete(db,stage.id);
  return summary;
}

/**
 * Simulate every pending fixture in the round containing the managed club's
 * next match. Passing a fixture ID uses that fixture to choose the round.
 * Completed fixtures are preserved, and each pending match is simulated once.
 */
export function advanceFixtureRound(db: SqliteDatabase, fixtureId?: number): MatchSummary[] {
  let selected: { id: number } | undefined;
  if (fixtureId !== undefined) {
    selected = db.prepare("SELECT id FROM fixture WHERE id=? AND status IN ('SCHEDULED','IN_PROGRESS')").get(fixtureId) as {id:number}|undefined;
    if (!selected) throw new Error(`Scheduled fixture ${fixtureId} not found (it may already be completed or is not playable).`);
  } else {
    const metadata = db.prepare("SELECT selected_club_id AS clubId FROM game_save_metadata LIMIT 1").get() as {clubId:number}|undefined;
    if (!metadata) throw new Error("Campaign metadata is missing; cannot find the managed club's next match.");
    selected = db.prepare(`
      SELECT f.id FROM fixture f
      WHERE f.status IN ('SCHEDULED','IN_PROGRESS')
        AND (f.home_club_id=? OR f.away_club_id=?)
      ORDER BY CASE f.status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END, f.scheduled_at, f.id
      LIMIT 1
    `).get(metadata.clubId, metadata.clubId) as {id:number}|undefined;
    if (!selected) throw new Error("No scheduled or in-progress fixtures remain for your club.");
  }
  const round = db.prepare(`
    SELECT r.id AS roundId, r.stage_id AS stageId
    FROM fixture f JOIN competition_round r ON r.id=f.round_id
    WHERE f.id=?
  `).get(selected.id) as {roundId:number;stageId:number}|undefined;
  if (!round) throw new Error(`Fixture ${selected.id} has no competition round.`);
  return advanceRoundById(db, round.roundId, round.stageId);
}

export function advanceRound(db: SqliteDatabase, roundId: number): MatchSummary[] {
  const round = db.prepare("SELECT id,stage_id AS stageId FROM competition_round WHERE id=?").get(roundId) as {id:number;stageId:number}|undefined;
  if (!round) throw new Error(`Round ID ${roundId} was not found.`);
  return advanceRoundById(db, round.id, round.stageId);
}

/** Resolve a round by its sequence within a stage, never by a global database ID. */
export function advanceStageRound(db: SqliteDatabase, stageId: number, roundNumber: number): MatchSummary[] {
  const round = db.prepare(`
    SELECT id,stage_id AS stageId FROM competition_round WHERE stage_id=? AND round_number=?
  `).get(stageId, roundNumber) as {id:number;stageId:number}|undefined;
  if (!round) {
    const available = db.prepare("SELECT round_number AS roundNumber,name FROM competition_round WHERE stage_id=? ORDER BY round_number")
      .all(stageId) as Array<{roundNumber:number;name:string}>;
    const description = available.map(item => `${item.roundNumber} (${item.name})`).join(", ");
    throw new Error(`Round number ${roundNumber} was not found in stage ${stageId}. Available rounds: ${description || "none"}.`);
  }
  return advanceRoundById(db, round.id, round.stageId);
}

function advanceRoundById(db: SqliteDatabase, roundId: number, stageId: number): MatchSummary[] {
  const round = db.prepare("SELECT round_number AS roundNumber,name FROM competition_round WHERE id=? AND stage_id=?")
    .get(roundId,stageId) as {roundNumber:number;name:string}|undefined;
  if (!round) throw new Error(`Round ID ${roundId} was not found in stage ${stageId}.`);
  const state = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed
    FROM fixture WHERE round_id=?
  `).get(roundId) as {total:number;completed:number|null};
  const fixtures = db.prepare("SELECT id FROM fixture WHERE round_id=? AND status IN ('SCHEDULED','IN_PROGRESS') ORDER BY CASE status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END,scheduled_at,id")
    .all(roundId) as Array<{id:number}>;
  if (!fixtures.length) {
    if (state.total > 0 && (state.completed ?? 0) === state.total) {
      // Recover post-match bookkeeping if the process stopped after the final
      // fixture committed but before knockout progression/standings/season status.
      const recoverRound = db.transaction(() => {
        progressKnockoutStage(db, stageId, roundId);
        rebuildStandings(db, stageId);
        finishSeasonIfComplete(db, stageId);
      });
      recoverRound.immediate();
      throw new Error(`Round ${round.roundNumber} (${round.name}) is already completed; post-match state was verified.`);
    }
    throw new Error(`Round ${round.roundNumber} (${round.name}) has no playable fixtures.`);
  }
  // Each match owns its per-minute transactions. One malformed fixture must not
  // prevent the remaining matches in the same round from being simulated.
  const results: MatchSummary[] = [];
  const failures: string[] = [];
  for (const fixture of fixtures) {
    try {
      results.push(simulateMatch(db,fixture.id));
    } catch (error) {
      failures.push(`fixture ${fixture.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const finalizeRound = db.transaction(() => {
    progressKnockoutStage(db, stageId, roundId);
    rebuildStandings(db,stageId);
    finishSeasonIfComplete(db,stageId);
  });
  finalizeRound.immediate();
  if (failures.length) {
    throw new Error(`Round ${round.roundNumber} simulated ${results.length}/${fixtures.length} matches. Failures: ${failures.join(" | ")}`);
  }
  return results;
}

function roundRobin(teams: ParticipantRow[], legs: number): Array<Array<{home:number;away:number}>> {
  if (teams.length < 2) throw new Error("A league needs at least two participants.");
  if (!Number.isSafeInteger(legs) || legs < 1) throw new Error("League legs must be a positive integer.");
  const rotating = teams.map(t => t.club_id);
  if (rotating.length % 2) rotating.push(-1);
  const n = rotating.length;
  const rounds: Array<Array<{home:number;away:number}>> = [];
  for (let r=0;r<n-1;r++) {
    const matches: Array<{home:number;away:number}> = [];
    for (let i=0;i<n/2;i++) {
      let home=rotating[i]!, away=rotating[n-1-i]!;
      if (home === -1 || away === -1) continue;
      if ((r+i)%2) [home,away] = [away,home];
      matches.push({home,away});
    }
    rounds.push(matches);
    const fixed=rotating[0]!;
    const rest=rotating.slice(1);
    rest.unshift(rest.pop()!);
    rotating.splice(0,rotating.length,fixed,...rest);
  }
  const first=rounds;
  const all=[...first];
  for (let leg=1;leg<legs;leg++) all.push(...first.map(matches=>matches.map(m=>({home:m.away,away:m.home}))));
  return all;
}


/**
 * Assign deterministic, position-aware factory squad profiles once per database.
 * Existing saves remain independent; only a save explicitly passed through this
 * factory initializer is profiled. Re-running initialization is idempotent.
 */
export function ensureFactorySquadProfiles(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS factory_balance_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      profile_version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  const current = db.prepare("SELECT profile_version FROM factory_balance_metadata WHERE id=1")
    .get() as {profile_version:number}|undefined;
  if (current?.profile_version === 1) return;

  const clubs = db.prepare("SELECT id, reputation FROM club ORDER BY reputation DESC, id")
    .all() as Array<{id:number;reputation:number}>;
  if (clubs.length !== 16) throw new Error("Squad recalibration requires a 16-club factory world.");
  const tiers = new Map<number, number>();
  clubs.forEach((club, index) => {
    // 3 elite, 4 competitive, 5 mid-table, 4 lower-table clubs.
    const tier = index < 3 ? 0 : index < 7 ? 1 : index < 12 ? 2 : 3;
    tiers.set(club.id, tier);
  });
  const attrs = [
    "pace","acceleration","stamina","strength","agility","positioning","anticipation",
    "decisions","composure","teamwork","work_rate","passing","vision","crossing",
    "dribbling","finishing","long_shots","heading","tackling","marking","aggression",
    "concentration","reflexes","handling","aerial_reach"
  ];
  const selectPlayers = db.prepare(`
    SELECT p.person_id AS id, p.goalkeeper, sm.shirt_number AS shirtNumber,
      (SELECT pp.position_code FROM player_position pp WHERE pp.player_id=p.person_id
       ORDER BY pp.rating DESC, pp.position_code LIMIT 1) AS position
    FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id
    WHERE sm.club_id=? ORDER BY sm.shirt_number, p.person_id
  `);
  const updateAttrs = db.prepare("UPDATE player_attribute SET " + attrs.map(a => a + "=?").join(",") + " WHERE player_id=?");
  const updatePosition = db.prepare("UPDATE player_position SET rating=? WHERE player_id=? AND position_code=?");
  const updateClub = db.prepare("UPDATE club SET reputation=? WHERE id=?");
  const update = db.transaction(() => {
    for (const club of clubs) {
      const tier = tiers.get(club.id)!;
      const base = [73, 66, 59, 52][tier]!;
      const identity = (club.id * 17) % 3;
      const players = selectPlayers.all(club.id) as Array<{
        id:number;goalkeeper:number;shirtNumber:number|null;position:string|null;
      }>;
      for (const player of players) {
        const role = player.position ?? (player.goalkeeper ? "GK" : "CM");
        const isBench = (player.shirtNumber ?? 99) > 11;
        const benchPenalty = isBench ? 5 + ((player.id + club.id) % 4) : 0;
        const roleBonus: Record<string, Partial<Record<string, number>>> = {
          GK: {reflexes:9,handling:8,aerial_reach:7,positioning:5,concentration:5,pace:-13,finishing:-16},
          CB: {tackling:8,marking:9,strength:6,heading:6,pace:-2,finishing:-12},
          LB: {tackling:4,marking:4,pace:5,stamina:5,crossing:5,finishing:-6},
          RB: {tackling:4,marking:4,pace:5,stamina:5,crossing:5,finishing:-6},
          LWB: {pace:6,stamina:6,crossing:6,tackling:3,marking:2},
          RWB: {pace:6,stamina:6,crossing:6,tackling:3,marking:2},
          DM: {tackling:5,marking:4,positioning:5,passing:3,work_rate:5,finishing:-7},
          CM: {passing:5,vision:5,decisions:4,teamwork:5,stamina:3},
          AM: {vision:7,passing:5,dribbling:5,composure:4,finishing:3,tackling:-5},
          LW: {pace:8,dribbling:7,crossing:5,finishing:3,tackling:-7,marking:-6},
          RW: {pace:8,dribbling:7,crossing:5,finishing:3,tackling:-7,marking:-6},
          LM: {pace:6,dribbling:5,crossing:6,stamina:4,tackling:-4},
          RM: {pace:6,dribbling:5,crossing:6,stamina:4,tackling:-4},
          ST: {finishing:9,composure:6,positioning:7,heading:4,tackling:-11,marking:-10}
        };
        const bonuses = roleBonus[role] ?? {};
        const specialization: Record<string, number> = {};
        if (identity === 0 && ["ST","LW","RW","AM"].includes(role)) {
          specialization.finishing = 4; specialization.dribbling = 3; specialization.vision = 2;
        } else if (identity === 1 && ["GK","CB","LB","RB","DM"].includes(role)) {
          specialization.tackling = 3; specialization.marking = 3; specialization.concentration = 3;
          specialization.reflexes = role === "GK" ? 4 : 0;
        } else if (identity === 2 && ["CM","DM","AM","LW","RW"].includes(role)) {
          specialization.passing = 3; specialization.vision = 3; specialization.stamina = 2;
        }
        const values = attrs.map((attribute, i) => {
          const deterministicNoise = ((player.id * 13 + club.id * 7 + i * 5) % 9) - 4;
          const value = base + (bonuses[attribute] ?? 0) + (specialization[attribute] ?? 0)
            - benchPenalty + deterministicNoise;
          return Math.max(28, Math.min(94, Math.round(value)));
        });
        updateAttrs.run(...values, player.id);
        const positionRating = Math.max(35, Math.min(94,
          base + (role === "GK" ? 4 : 0) + (isBench ? -5 : 3)
          + ((player.id * 11 + club.id) % 7) - 3));
        if (player.position) updatePosition.run(positionRating, player.id, player.position);
      }
      // Reputation communicates expected club stature, but is not used as a match bonus.
      const reputation = Math.max(25, Math.min(92, base + 15 + ((club.id * 3) % 5) - 2));
      updateClub.run(reputation, club.id);
    }
    db.prepare("INSERT INTO factory_balance_metadata(id,profile_version) VALUES(1,1) ON CONFLICT(id) DO UPDATE SET profile_version=excluded.profile_version,applied_at=CURRENT_TIMESTAMP").run();
  });
  update();
}

export interface FactoryCalendarRepair {
  repaired: boolean;
  rounds: number;
  fixtures: number;
}

/** Upgrade only the untouched factory world to 16 playable clubs. Existing saves are independent copies. */
export function ensureFactoryWorld16(db: SqliteDatabase): { upgraded:boolean; clubs:number; leagueFixtures:number; cupEntrants:number } {
  const clubCount=(db.prepare("SELECT COUNT(*) AS count FROM club").get() as {count:number}).count;
  const league=db.prepare("SELECT st.id AS stageId,cs.id AS seasonId FROM competition_stage st JOIN competition_season cs ON cs.id=st.season_id JOIN competition co ON co.id=cs.competition_id WHERE co.name='Liga Nacional de Teste' AND cs.season_year=2026 AND st.stage_kind='LEAGUE'").get() as {stageId:number;seasonId:number}|undefined;
  const cup=db.prepare("SELECT st.id AS stageId,cs.id AS seasonId FROM competition_stage st JOIN competition_season cs ON cs.id=st.season_id JOIN competition co ON co.id=cs.competition_id WHERE co.name='Copa Nacional de Teste' AND cs.season_year=2026 AND st.stage_kind='KNOCKOUT'").get() as {stageId:number;seasonId:number}|undefined;
  if(!league||!cup) throw new Error("The factory league or cup was not found; the 16-club upgrade was not applied.");
  const leagueCount=(db.prepare("SELECT COUNT(*) AS count FROM stage_participant WHERE stage_id=?").get(league.stageId) as {count:number}).count;
  const cupCount=(db.prepare("SELECT COUNT(*) AS count FROM stage_participant WHERE stage_id=?").get(cup.stageId) as {count:number}).count;
  const leagueFixtures=(db.prepare("SELECT COUNT(*) AS count FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=?").get(league.stageId) as {count:number}).count;
  if(clubCount===16&&leagueCount===16&&cupCount===16) { ensureFactorySquadProfiles(db); return {upgraded:false,clubs:16,leagueFixtures,cupEntrants:16}; }
  if(clubCount!==4||leagueCount!==4||cupCount!==4) throw new Error("Factory world is neither the original four-club seed nor a complete 16-club world; no automatic upgrade was attempted.");
  const played=(db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE status<>'SCHEDULED'").get() as {count:number}).count;
  if(played>0) throw new Error("The factory world contains played or non-scheduled fixtures. It was not upgraded; existing saves are not changed.");
  const names=[
    ["Atlético das Palmeiras","ADP",46],["Real de Santa Luzia","RSL",44],
    ["Grêmio da Serra","GDS",42],["Ferroviário do Litoral","FDL",40],
    ["Esportivo Campo Azul","ECA",38],["Nacional de Pedra Branca","NPB",36],
    ["Desportivo São Bento","DSB",34],["Associação Vila Nova","AVN",32],
    ["Clube Atlético do Cerrado","CAC",30],["União das Águas","UDA",28],
    ["Operário de Santa Rita","OSR",26],["Independente do Sul","IDS",24]
  ] as const;
  const attributeColumns=(db.pragma("table_info(player_attribute)") as Array<{name:string}>).map(row=>row.name).filter(name=>name!=="player_id");
  const playerColumns=(db.pragma("table_info(player)") as Array<{name:string}>).map(row=>row.name).filter(name=>name!=="person_id");
  const nextPersonId=(db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM person").get() as {id:number}).id;
  const insertWorld=db.transaction(()=>{
    const insertClub=db.prepare("INSERT INTO club(id,nation_id,city_id,name,short_name,reputation) VALUES(?,1,?,?,?,?)");
    const insertStadium=db.prepare("INSERT INTO stadium(club_id,city_id,name,capacity,pitch_quality) VALUES(?,?,?,?,?)");
    const insertPerson=db.prepare("INSERT INTO person(id,full_name,birth_date,nationality_id) VALUES(?,?,?,1)");
    const insertPlayer=db.prepare("INSERT INTO player(person_id,"+playerColumns.join(",")+") SELECT ?,"+playerColumns.join(",")+" FROM player WHERE person_id=?");
    const insertAttributes=db.prepare("INSERT INTO player_attribute(player_id,"+attributeColumns.join(",")+") SELECT ?,"+attributeColumns.join(",")+" FROM player_attribute WHERE player_id=?");
    const insertPositions=db.prepare("INSERT INTO player_position(player_id,position_code,rating) SELECT ?,position_code,rating FROM player_position WHERE player_id=?");
    const insertMembership=db.prepare("INSERT INTO squad_membership(player_id,club_id,shirt_number,squad_status) VALUES(?,?,?,'FIRST_TEAM')");
    const insertCondition=db.prepare("INSERT INTO player_condition(player_id,energy,morale,sharpness,injured_until,suspension_matches) SELECT ?,energy,morale,sharpness,NULL,0 FROM player_condition WHERE player_id=?");
    const sourceSquads=db.prepare("SELECT sm.player_id AS playerId,sm.shirt_number AS shirtNumber,pe.birth_date AS birthDate FROM squad_membership sm JOIN person pe ON pe.id=sm.player_id WHERE sm.club_id=? ORDER BY sm.shirt_number,sm.player_id");
    let personId=nextPersonId;
    for(let index=0;index<names.length;index++){
      const clubId=5+index,cityId=clubId%2===1?1:2,[name,short,reputation]=names[index]!;
      insertClub.run(clubId,cityId,name,short,reputation);
      insertStadium.run(clubId,cityId,"Estádio "+name,7000+reputation*250,58+Math.floor(reputation/4));
      db.prepare("INSERT INTO team_tactic(club_id,formation_id) VALUES(?,1)").run(clubId);
      const sourceClub=1+(index%4);
      for(const source of sourceSquads.all(sourceClub) as Array<{playerId:number;shirtNumber:number;birthDate:string|null}>){
        const id=personId++;
        insertPerson.run(id,"Jogador "+id+" - "+name,source.birthDate);
        insertPlayer.run(id,source.playerId);
        insertAttributes.run(id,source.playerId);
        insertPositions.run(id,source.playerId);
        insertMembership.run(id,clubId,source.shirtNumber);
        insertCondition.run(id,source.playerId);
      }
    }
    db.prepare("DELETE FROM competition_round WHERE stage_id IN (?,?)").run(league.stageId,cup.stageId);
    db.prepare("DELETE FROM stage_standing WHERE stage_id=?").run(league.stageId);
    db.prepare("DELETE FROM stage_participant WHERE stage_id IN (?,?)").run(league.stageId,cup.stageId);
    db.prepare("DELETE FROM competition_entry WHERE season_id IN (?,?)").run(league.seasonId,cup.seasonId);
    const clubs=db.prepare("SELECT id FROM club ORDER BY id").all() as Array<{id:number}>;
    const insertParticipant=db.prepare("INSERT INTO stage_participant(stage_id,club_id,group_id,seed) VALUES(?,?,?,?)");
    const insertEntry=db.prepare("INSERT INTO competition_entry(season_id,club_id,seed) VALUES(?,?,?)");
    clubs.forEach((club,index)=>{
      const seed=index+1;
      insertParticipant.run(league.stageId,club.id,1,seed);
      insertParticipant.run(cup.stageId,club.id,2,seed);
      insertEntry.run(league.seasonId,club.id,seed);
      insertEntry.run(cup.seasonId,club.id,seed);
      db.prepare("INSERT INTO stage_standing(stage_id,club_id,group_id) VALUES(?,?,1)").run(league.stageId,club.id);
    });
    db.prepare("UPDATE competition_season SET status='PLANNED' WHERE id IN (?,?)").run(league.seasonId,cup.seasonId);
    const cupStart="2026-03-01";
    const cupRoundId=Number(db.prepare("INSERT INTO competition_round(stage_id,round_number,name,start_date,end_date) VALUES(?,1,'Oitavas de final',?,?)").run(cup.stageId,cupStart,cupStart).lastInsertRowid);
    const insertFixture=db.prepare("INSERT INTO fixture(round_id,home_club_id,away_club_id,stadium_id,scheduled_at,random_seed) VALUES(?,?,?,?,?,?)");
    for(let i=0;i<clubs.length;i+=2){
      const home=clubs[i]!,away=clubs[i+1]!;
      const stadium=db.prepare("SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1").get(home.id) as {id:number}|undefined;
      insertFixture.run(cupRoundId,home.id,away.id,stadium?.id??null,cupStart+"T"+String(14+(i/2%4)*2).padStart(2,"0")+":00:00",22001+i);
    }
  });
  insertWorld();
  const calendar=ensureFactoryLeagueCalendar(db);
  ensureFactorySquadProfiles(db);
  if(calendar.fixtures!==240) throw new Error("The 16-club league calendar was not generated correctly ("+calendar.fixtures+" fixtures).");
  return {upgraded:true,clubs:16,leagueFixtures:calendar.fixtures,cupEntrants:16};
}

/** Reconcile the untouched factory league calendar without modifying played matches. */
export function ensureFactoryLeagueCalendar(db: SqliteDatabase): FactoryCalendarRepair {
  const stage = db.prepare(`
    SELECT st.id AS stageId, cs.season_year AS year, cs.start_date AS startDate, sf.legs AS legs
    FROM competition_stage st
    JOIN competition_season cs ON cs.id=st.season_id
    JOIN competition co ON co.id=cs.competition_id
    JOIN stage_format sf ON sf.stage_id=st.id
    WHERE co.name='Liga Nacional de Teste' AND cs.season_year=2026 AND st.stage_kind='LEAGUE'
    ORDER BY st.id LIMIT 1
  `).get() as {stageId:number;year:number;startDate:string|null;legs:number}|undefined;
  if (!stage || stage.legs !== 2) return {repaired:false,rounds:0,fixtures:0};

  const participants = db.prepare("SELECT club_id,group_id,seed FROM stage_participant WHERE stage_id=? ORDER BY seed,club_id")
    .all(stage.stageId) as ParticipantRow[];
  if (participants.length < 2) return {repaired:false,rounds:0,fixtures:0};

  const rounds = roundRobin(participants,stage.legs);
  const currentRounds = db.prepare("SELECT id,round_number AS roundNumber FROM competition_round WHERE stage_id=? ORDER BY round_number")
    .all(stage.stageId) as Array<{id:number;roundNumber:number}>;
  const currentFixtures = db.prepare(`
    SELECT f.id,f.status FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=?
  `).all(stage.stageId) as Array<{id:number;status:string}>;
  const roundCounts = db.prepare(`
    SELECT COUNT(f.id) AS fixtures FROM competition_round r
    LEFT JOIN fixture f ON f.round_id=r.id WHERE r.stage_id=? GROUP BY r.id
  `).all(stage.stageId) as Array<{fixtures:number}>;
  const expectedFixtures = rounds.reduce((sum,round)=>sum+round.length,0);
  const isCorrect = currentRounds.length===rounds.length &&
    currentRounds.every((round,index)=>round.roundNumber===index+1) &&
    currentFixtures.length===expectedFixtures &&
    roundCounts.length===rounds.length && roundCounts.every(row=>row.fixtures===Math.floor(participants.length/2));
  if (isCorrect) return {repaired:false,rounds:currentRounds.length,fixtures:currentFixtures.length};

  if (currentFixtures.some(fixture=>fixture.status!=="SCHEDULED")) {
    throw new Error("The factory league calendar is incomplete but contains played or non-scheduled fixtures. It was not changed; back up the master database before any manual repair.");
  }

  const create = db.transaction(() => {
    db.prepare("DELETE FROM competition_round WHERE stage_id=?").run(stage.stageId);
    const insertRound = db.prepare("INSERT INTO competition_round(stage_id,round_number,name,start_date,end_date) VALUES (?,?,?,?,?)");
    const insertFixture = db.prepare(`
      INSERT INTO fixture(round_id,home_club_id,away_club_id,stadium_id,scheduled_at,random_seed)
      VALUES (?,?,?,?,?,?)
    `);
    const start = stage.startDate ? new Date(`${stage.startDate}T00:00:00Z`) : new Date("2026-01-10T00:00:00Z");
    rounds.forEach((matches,roundIndex)=>{
      const roundNumber=roundIndex+1;
      const dateValue=new Date(start);
      dateValue.setUTCDate(dateValue.getUTCDate()+roundIndex*7);
      const date=dateValue.toISOString().slice(0,10);
      const roundId=Number(insertRound.run(stage.stageId,roundNumber,`Rodada ${roundNumber}`,date,date).lastInsertRowid);
      matches.forEach((match,matchIndex)=>{
        const stadium=db.prepare("SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1").get(match.home) as {id:number}|undefined;
        const scheduledAt=`${date}T${String(16+matchIndex*2).padStart(2,"0")}:00:00`;
        const seed=((stage.year*100000)+(roundNumber*100)+matchIndex+1)>>>0;
        insertFixture.run(roundId,match.home,match.away,stadium?.id??null,scheduledAt,seed);
      });
    });
  });
  create();
  return {repaired:true,rounds:rounds.length,fixtures:expectedFixtures};
}

export function prepareNextLeagueSeason(db: SqliteDatabase, stageId: number): {seasonId:number;year:number;fixtures:number} {
  const stage = getStage(db,stageId);
  if (stage.stage_kind !== "LEAGUE") throw new Error("Only league stages can generate the next season in this MVP.");
  if (stage.season_status !== "COMPLETED") throw new Error("Cannot prepare a new season before the current season is completed.");
  const existing = db.prepare(`
    SELECT cs.id AS seasonId,cs.season_year AS year,st.id AS stageId,COUNT(f.id) AS fixtureCount
    FROM competition_season cs JOIN competition_stage st ON st.season_id=cs.id
    LEFT JOIN competition_round r ON r.stage_id=st.id LEFT JOIN fixture f ON f.round_id=r.id
    WHERE cs.competition_id=? AND cs.season_year=? GROUP BY cs.id,st.id
  `).get(stage.competition_id,stage.season_year+1) as {seasonId:number;year:number;stageId:number;fixtureCount:number}|undefined;
  if (existing) { applyRosterSeason(db,existing.year); return {seasonId:existing.seasonId,year:existing.year,fixtures:existing.fixtureCount}; }

  const format = db.prepare("SELECT * FROM stage_format WHERE stage_id=?").get(stageId) as {
    legs:number;group_count:number;home_away:number;extra_time:number;penalties:number;
    away_goals_rule:number;win_points:number;draw_points:number;loss_points:number;
  }|undefined;
  const legs=format?.legs??1;
  const participants = db.prepare("SELECT club_id,group_id,seed FROM stage_participant WHERE stage_id=? ORDER BY seed,club_id")
    .all(stageId) as ParticipantRow[];
  if (participants.length<2) throw new Error("Cannot generate a league season without at least two participants.");

  const create = db.transaction(() => {
    const year=stage.season_year+1;
    const seasonId=db.prepare("INSERT INTO competition_season (competition_id,season_year,status) VALUES (?,?, 'PLANNED')")
      .run(stage.competition_id,year).lastInsertRowid as number;
    const newStageId=db.prepare("INSERT INTO competition_stage (season_id,name,stage_order,stage_kind) VALUES (?,?,1,'LEAGUE')")
      .run(seasonId,stage.stage).lastInsertRowid as number;

    db.prepare(`
      INSERT INTO stage_format (stage_id,group_count,legs,home_away,extra_time,penalties,away_goals_rule,win_points,draw_points,loss_points)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(newStageId,format?.group_count??1,legs,format?.home_away??1,format?.extra_time??0,
        format?.penalties??0,format?.away_goals_rule??0,format?.win_points??3,format?.draw_points??1,format?.loss_points??0);
    db.prepare(`
      INSERT INTO stage_group (stage_id,group_code,name,sort_order)
      SELECT ?,group_code,name,sort_order FROM stage_group WHERE stage_id=?
    `).run(newStageId,stageId);
    db.prepare(`
      INSERT INTO stage_standing_rule (stage_id,rule_order,rule_key)
      SELECT ?,rule_order,rule_key FROM stage_standing_rule WHERE stage_id=?
    `).run(newStageId,stageId);
    db.prepare(`
      INSERT INTO schedule_profile (stage_id,min_rest_hours,max_matches_7_days,default_match_duration_minutes,home_away_balance,avoid_same_opponent_consecutive,travel_fatigue_enabled)
      SELECT ?,min_rest_hours,max_matches_7_days,default_match_duration_minutes,home_away_balance,avoid_same_opponent_consecutive,travel_fatigue_enabled
      FROM schedule_profile WHERE stage_id=?
    `).run(newStageId,stageId);
    const newGroups = db.prepare("SELECT id,group_code,sort_order FROM stage_group WHERE stage_id=? ORDER BY sort_order").all(newStageId) as Array<{id:number;group_code:string;sort_order:number}>;
    const oldGroups = db.prepare("SELECT id,group_code FROM stage_group WHERE stage_id=?").all(stageId) as Array<{id:number;group_code:string}>;
    const oldCode = new Map(oldGroups.map(g=>[g.id,g.group_code]));
    const groupIds = new Map(newGroups.map(g=>[g.group_code,g.id]));
    const insertParticipant=db.prepare("INSERT INTO stage_participant (stage_id,club_id,group_id,seed) VALUES (?,?,?,?)");
    const insertStanding=db.prepare("INSERT INTO stage_standing (stage_id,club_id,group_id) VALUES (?,?,?)");
    participants.forEach((p,i)=>{
      const groupId=groupIds.get(oldCode.get(p.group_id) ?? "") ?? newGroups[0]!.id;
      insertParticipant.run(newStageId,p.club_id,groupId,i+1);
      insertStanding.run(newStageId,p.club_id,groupId);
    });
    const rounds=roundRobin(participants,legs);
    const insertRound=db.prepare("INSERT INTO competition_round (stage_id,round_number,name,start_date,end_date) VALUES (?,?,?,?,?)");
    const insertFixture=db.prepare("INSERT INTO fixture (round_id,home_club_id,away_club_id,stadium_id,scheduled_at,random_seed) VALUES (?,?,?,?,?,?)");
    const firstDate=new Date(Date.UTC(year,0,10));
    let fixtureCount=0;
    rounds.forEach((matches,ri)=>{
      const date=new Date(firstDate.getTime()+ri*7*86400000).toISOString().slice(0,10);
      const roundId=insertRound.run(newStageId,ri+1,`Rodada ${ri+1}`,date,date).lastInsertRowid as number;
      matches.forEach((m,mi)=>{
        const stadium=db.prepare("SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1").get(m.home) as {id:number}|undefined;
        const time=`${date}T${String(16+(mi%2)*2).padStart(2,"0")}:00:00`;
        const seed=(year*100000+(ri+1)*100+mi+1)>>>0;
        insertFixture.run(roundId,m.home,m.away,stadium?.id??null,time,seed);
        fixtureCount++;
      });
    });
    return {seasonId,year,fixtures:fixtureCount};
  });
  const result=create();
  applyRosterSeason(db,result.year);
  return result;
}
