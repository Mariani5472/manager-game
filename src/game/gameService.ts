import type { SqliteDatabase } from "../db/database.js";
import { simulateMatch, type MatchSummary } from "./matchEngine.js";

export interface FixtureInfo {
  id: number; competition: string; stage: string; round: string; scheduledAt: string | null;
  homeClub: string; awayClub: string; status: string; score: string | null;
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
           ELSE f.home_score || ' - ' || f.away_score END AS score
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
    return {
      seasonId:stage.season_id, competition:stage.competition, seasonYear:stage.season_year,
      seasonStatus:stage.season_status, stageId:stage.stage_id, stage:stage.stage,
      stageKind:stage.stage_kind, stageStatus:pending === 0 && completed > 0 ? "COMPLETED" : "IN_PROGRESS",
      pendingFixtures:pending, completedFixtures:completed,
    };
  });
}

const standingFields: Record<string, keyof StandingRow> = {
  POINTS:"points", WINS:"wins", GOAL_DIFFERENCE:"goalDifference", GOALS_FOR:"goalsFor",
  FAIR_PLAY:"fairPlayPoints",
};

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
  return rows.sort((a,b) => {
    for (const {rule_key} of rules) {
      const field = standingFields[rule_key];
      if (field && a[field] !== b[field]) return Number(b[field])-Number(a[field]);
    }
    return a.club.localeCompare(b.club,"pt-BR") || a.clubId-b.clubId;
  });
}

function rebuildStandings(db: SqliteDatabase, stageId: number): void {
  getStage(db, stageId);
  const rebuild = db.transaction(() => {
    db.prepare("DELETE FROM stage_standing WHERE stage_id=?").run(stageId);
    db.prepare(`
      INSERT INTO stage_standing (stage_id,club_id,group_id,played,wins,draws,losses,goals_for,goals_against,points)
      SELECT stage_id,club_id,group_id,0,0,0,0,0,0,0 FROM stage_participant WHERE stage_id=?
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
  });
  rebuild();
}

function finishSeasonIfComplete(db: SqliteDatabase, stageId: number): void {
  const stage = getStage(db,stageId);
  if (stage.stage_kind !== "LEAGUE") return;
  const counts = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN status IN ('SCHEDULED','IN_PROGRESS','POSTPONED') THEN 1 ELSE 0 END) AS pending
    FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=?
  `).get(stageId) as {total:number;completed:number|null;pending:number|null};
  if (counts.total > 0 && (counts.pending ?? 0) === 0) {
    db.prepare("UPDATE competition_season SET status='COMPLETED' WHERE id=?").run(stage.season_id);
  } else {
    db.prepare("UPDATE competition_season SET status='ACTIVE' WHERE id=? AND status='PLANNED'").run(stage.season_id);
  }
}

export function advanceNextFixture(db: SqliteDatabase, fixtureId?: number): MatchSummary {
  const run = db.transaction(() => {
    const row = fixtureId
      ? db.prepare("SELECT id FROM fixture WHERE id=? AND status IN ('SCHEDULED','IN_PROGRESS')").get(fixtureId) as {id:number}|undefined
      : db.prepare("SELECT id FROM fixture WHERE status IN ('SCHEDULED','IN_PROGRESS') ORDER BY CASE status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END,scheduled_at,id LIMIT 1").get() as {id:number}|undefined;
    if (!row) throw new Error(fixtureId ? `Playable fixture ${fixtureId} not found (it may already be completed).` : "No playable fixtures remain.");
    const stage = db.prepare("SELECT r.stage_id AS id FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE f.id=?")
      .get(row.id) as {id:number}|undefined;
    if (!stage) throw new Error(`Fixture ${row.id} has no competition stage.`);
    const summary = simulateMatch(db,row.id);
    rebuildStandings(db,stage.id);
    finishSeasonIfComplete(db,stage.id);
    return summary;
  });
  return run.immediate();
}

export function advanceRound(db: SqliteDatabase, roundId: number): MatchSummary[] {
  const round = db.prepare("SELECT id,stage_id AS stageId FROM competition_round WHERE id=?").get(roundId) as {id:number;stageId:number}|undefined;
  if (!round) throw new Error(`Round ${roundId} was not found.`);
  const fixtures = db.prepare("SELECT id FROM fixture WHERE round_id=? AND status='SCHEDULED' ORDER BY scheduled_at,id")
    .all(roundId) as Array<{id:number}>;
  if (!fixtures.length) throw new Error(`Round ${roundId} has no scheduled fixtures.`);
  const run = db.transaction(() => {
    const results = fixtures.map(f => simulateMatch(db,f.id));
    rebuildStandings(db,round.stageId);
    finishSeasonIfComplete(db,round.stageId);
    return results;
  });
  return run.immediate();
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
  if (existing) return {seasonId:existing.seasonId,year:existing.year,fixtures:existing.fixtureCount};

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
  return create();
}
