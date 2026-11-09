import {masterPath,saveDir} from "../../../client/config.js";
import type {SqliteDatabase} from "../../../db/database.js";
import {SaveManager} from "../../../save/saveManager.js";
import {getManagedClub} from "./club.repository.js";
import {listFixtures} from "./fixture.repository.js";
import {listSquad,getTactics} from "./squad.repository.js";
import {getSeasonStatus} from "../../competitions/repo/competition.repository.js";
import {getStandings,rebuildStandings} from "../../competitions/repo/standings.repository.js";
import {previewLineup,saveLineup} from "./lineup.repository.js";
import {simulateMatch} from "../../matches/service/match-simulation.service.js";
import {progressKnockoutStage} from "../../competitions/service/knockout.service.js";
import {finishSeasonIfComplete} from "../../competitions/service/season.service.js";
import type {CampaignClubDto,CampaignOverviewResponse,CampaignCalendarResponse,CampaignSquadResponse,CampaignTeamResponse,MatchCenterResponse,MatchPreparationResponse,MatchFixtureDto,MatchLineupPlayerDto,SaveMatchLineupRequest} from "../../../shared/src/index.js";
import type {CampaignRepository} from "../campaign.repository.js";
import {SaveNotFoundError} from "../../saves/save-not-found.error.js";
export class SqliteCampaignRepository implements CampaignRepository {
 private readonly manager=new SaveManager(masterPath,saveDir);
 private withSave<T>(id:string,query:(db:SqliteDatabase)=>T):T {
  const save=this.manager.list().find(item=>item.id===id); if(!save) throw new SaveNotFoundError(id);
  const db=this.manager.open(save.filePath); try{return query(db);}finally{db.close();}
 }
 private club(db:SqliteDatabase):CampaignClubDto {
  const managed=getManagedClub(db);
  const extra=db.prepare("SELECT c.reputation,city.name AS city,st.name AS stadium,st.capacity AS stadiumCapacity FROM club c LEFT JOIN city ON city.id=c.city_id LEFT JOIN stadium st ON st.club_id=c.id WHERE c.id=? ORDER BY st.id LIMIT 1").get(managed.id) as {reputation:number;city:string|null;stadium:string|null;stadiumCapacity:number|null};
  return {...managed,...extra};
 }
 private metadata(db:SqliteDatabase) {
  const value=db.prepare("SELECT id,name,manager_name AS managerName FROM game_save_metadata LIMIT 1").get() as {id:string;name:string;managerName:string}|undefined;
  if(!value) throw new Error("Campaign metadata is missing."); return value;
 }
 overview(id:string):CampaignOverviewResponse {
  return this.withSave(id,db=>{
   const club=this.club(db),fixtures=listFixtures(db).filter(f=>f.homeClub===club.name||f.awayClub===club.name);
   const nextFixture=fixtures.find(f=>["SCHEDULED","IN_PROGRESS","POSTPONED"].includes(f.status))??null;
   const recentResult=[...fixtures].reverse().find(f=>f.status==="COMPLETED")??null;
   const competitions=getSeasonStatus(db).filter(s=>Boolean(db.prepare("SELECT 1 FROM stage_participant WHERE stage_id=? AND club_id=?").get(s.stageId,club.id))).map(s=>{
    const rows=s.stageKind==="LEAGUE"?getStandings(db,s.stageId,false):[];
    return {competition:s.competition,stage:s.stage,seasonYear:s.seasonYear,stageStatus:s.stageStatus,pendingFixtures:s.pendingFixtures,completedFixtures:s.completedFixtures,stageId:s.stageId,standing:rows.map((row,index)=>({position:index+1,club:row.club,played:row.played,wins:row.wins,draws:row.draws,losses:row.losses,goalsFor:row.goalsFor,goalsAgainst:row.goalsAgainst,goalDifference:row.goalDifference,points:row.points,isManaged:row.clubId===club.id}))};
   });
   return {save:this.metadata(db),club,nextFixture,recentResult,competitions,squadSize:listSquad(db,club.id).length};
  });
 }
 calendar(id:string):CampaignCalendarResponse {
  return this.withSave(id,db=>{const club=getManagedClub(db);return {fixtures:listFixtures(db).filter(f=>f.homeClub===club.name||f.awayClub===club.name)};});
 }
 squad(id:string):CampaignSquadResponse {return this.withSave(id,db=>{const club=this.club(db);return {club,players:listSquad(db,club.id)};});}
 team(id:string):CampaignTeamResponse {
  return this.withSave(id,db=>{
   const club=this.club(db),tactics=getTactics(db,club.id);
   const exists=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='club_finance'").get());
   const finances=exists?db.prepare("SELECT f.balance,f.transfer_budget AS transferBudget,f.weekly_wage_budget AS weeklyWageBudget,COALESCE((SELECT SUM(pc.weekly_wage) FROM player_contract pc WHERE pc.club_id=c.id AND pc.status='ACTIVE'),0) AS wageBillWeekly,(SELECT COUNT(*) FROM squad_membership sm WHERE sm.club_id=c.id) AS squadSize FROM club c JOIN club_finance f ON f.club_id=c.id WHERE c.id=?").get(club.id) as CampaignTeamResponse["finances"]:null;
   return {club,tactics,finances};
  });
 }
 private fixture(db:SqliteDatabase,fixtureId:number):MatchFixtureDto {
  const row=db.prepare(`
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
  `).get(fixtureId) as {id:number;competition:string;stage:string;round:string;scheduledAt:string|null;status:MatchFixtureDto["status"];currentMinute:number;homeId:number;homeName:string;awayId:number;awayName:string;homeScore:number|null;awayScore:number|null;homePenalties:number|null;awayPenalties:number|null}|undefined;
  if(!row) throw new Error(`Fixture ${fixtureId} not found.`);
  return {id:row.id,competition:row.competition,stage:row.stage,round:row.round,scheduledAt:row.scheduledAt,status:row.status,currentMinute:row.currentMinute??0,home:{clubId:row.homeId,name:row.homeName},away:{clubId:row.awayId,name:row.awayName},score:{home:row.homeScore??0,away:row.awayScore??0,homePenalties:row.homePenalties,awayPenalties:row.awayPenalties}};
 }
 private lineup(db:SqliteDatabase,fixtureId:number,clubId:number):MatchLineupPlayerDto[] {
  const saved=db.prepare(`
   SELECT ml.player_id AS playerId,pe.full_name AS name,ml.position_code AS position,
    ml.slot_number AS slot,ml.is_starting AS isStarting,
    COALESCE(pc.energy,100) AS energy,COALESCE(pc.morale,50) AS morale,COALESCE(pc.sharpness,50) AS sharpness
   FROM match_lineup ml JOIN person pe ON pe.id=ml.player_id
   LEFT JOIN player_condition pc ON pc.player_id=ml.player_id
   WHERE ml.fixture_id=? AND ml.club_id=? ORDER BY ml.is_starting DESC,ml.slot_number
  `).all(fixtureId,clubId) as Array<{playerId:number;name:string;position:string;slot:number;isStarting:number;energy:number;morale:number;sharpness:number}>;
  if(saved.length) return saved.map(p=>({...p,isStarting:p.isStarting===1}));
  const preview=previewLineup(db,clubId,fixtureId);
  return [...preview.starters,...preview.bench].map(p=>({playerId:p.playerId,name:p.name,position:p.position,slot:p.slot,isStarting:p.isStarting,energy:p.energy,morale:p.morale,sharpness:p.sharpness}));
 }
 matchPreparation(id:string,fixtureId:number):MatchPreparationResponse {
  return this.withSave(id,db=>{
   const fixture=this.fixture(db,fixtureId);
   if(!["SCHEDULED","IN_PROGRESS"].includes(fixture.status)) throw new Error("This fixture is no longer available for preparation.");
   const managedClubId=getManagedClub(db).id;
   return {fixture,managedClubId,homeLineup:this.lineup(db,fixtureId,fixture.home.clubId),awayLineup:this.lineup(db,fixtureId,fixture.away.clubId),managedClubIsHome:managedClubId===fixture.home.clubId};
  });
 }
 saveMatchLineup(id:string,fixtureId:number,input:SaveMatchLineupRequest):MatchPreparationResponse {
  return this.withSave(id,db=>{
   const managedClubId=getManagedClub(db).id;
   saveLineup(db,fixtureId,managedClubId,input.starterIds,input.benchIds);
   const fixture=this.fixture(db,fixtureId);
   return {fixture,managedClubId,homeLineup:this.lineup(db,fixtureId,fixture.home.clubId),awayLineup:this.lineup(db,fixtureId,fixture.away.clubId),managedClubIsHome:managedClubId===fixture.home.clubId};
  });
 }
 matchCenter(id:string,fixtureId:number):MatchCenterResponse {
  return this.withSave(id,db=>{
   const fixture=this.fixture(db,fixtureId);
   const rows=db.prepare("SELECT id,minute,club_id AS clubId,player_id AS playerId,secondary_player_id AS secondaryPlayerId,event_type AS type,xg,description FROM match_event WHERE fixture_id=? ORDER BY minute,id").all(fixtureId) as Array<{id:number;minute:number;clubId:number|null;playerId:number|null;secondaryPlayerId:number|null;type:MatchCenterResponse["events"][number]["type"];xg:number|null;description:string|null}>;
   const momentum=db.prepare("SELECT minute,home_pressure AS homePressure,away_pressure AS awayPressure,home_score AS homeScore,away_score AS awayScore FROM match_momentum WHERE fixture_id=? ORDER BY minute").all(fixtureId) as MatchCenterResponse["momentum"];
   const aggregate=(clubId:number)=>{
    const count=(types:string[])=>rows.filter(e=>e.clubId===clubId&&types.includes(e.type)).length;
    return {shots:count(["GOAL","SAVE","MISS"]),shotsOnTarget:count(["GOAL","SAVE"]),goals:count(["GOAL"]),expectedGoals:rows.filter(e=>e.clubId===clubId&&["GOAL","SAVE","MISS"].includes(e.type)).reduce((sum,e)=>sum+(e.xg??0),0),fouls:count(["FOUL"]),yellowCards:count(["YELLOW_CARD"]),redCards:count(["RED_CARD"]),substitutions:count(["SUBSTITUTION"]),injuries:count(["INJURY"])};
   };
   const home=this.lineup(db,fixtureId,fixture.home.clubId),away=this.lineup(db,fixtureId,fixture.away.clubId);
   return {fixture,playbackStatus:fixture.status==="COMPLETED"?"FINISHED":fixture.status==="IN_PROGRESS"?"PAUSED":"IDLE",teams:[{clubId:fixture.home.clubId,name:fixture.home.name,isHome:true,lineup:home},{clubId:fixture.away.clubId,name:fixture.away.name,isHome:false,lineup:away}],statistics:{home:aggregate(fixture.home.clubId),away:aggregate(fixture.away.clubId)},events:rows.map(e=>({id:e.id,fixtureId,minute:e.minute,addedTime:0,type:e.type,clubId:e.clubId,playerId:e.playerId,secondaryPlayerId:e.secondaryPlayerId,xg:e.xg,description:e.description})),momentum};
  });
 }
 advanceMatch(id:string,fixtureId:number,throughMinute:number):MatchCenterResponse {
  return this.withSave(id,db=>{
   const fixture=this.fixture(db,fixtureId);
   if(fixture.status==="COMPLETED") return this.matchCenterFromDb(db,fixtureId);
   const summary=simulateMatch(db,fixtureId,throughMinute);
   if(summary.minutes===90) {
    const stage=db.prepare("SELECT r.stage_id AS stageId,r.id AS roundId FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE f.id=?").get(fixtureId) as {stageId:number;roundId:number};
    const finalize=db.transaction(()=>{progressKnockoutStage(db,stage.stageId,stage.roundId);rebuildStandings(db,stage.stageId);finishSeasonIfComplete(db,stage.stageId);});
    finalize.immediate();
   }
   return this.matchCenterFromDb(db,fixtureId);
  });
 }
 private matchCenterFromDb(db:SqliteDatabase,fixtureId:number):MatchCenterResponse {
  const fixture=this.fixture(db,fixtureId);
  const rows=db.prepare("SELECT id,minute,club_id AS clubId,player_id AS playerId,secondary_player_id AS secondaryPlayerId,event_type AS type,xg,description FROM match_event WHERE fixture_id=? ORDER BY minute,id").all(fixtureId) as Array<{id:number;minute:number;clubId:number|null;playerId:number|null;secondaryPlayerId:number|null;type:MatchCenterResponse["events"][number]["type"];xg:number|null;description:string|null}>;
  const momentum=db.prepare("SELECT minute,home_pressure AS homePressure,away_pressure AS awayPressure,home_score AS homeScore,away_score AS awayScore FROM match_momentum WHERE fixture_id=? ORDER BY minute").all(fixtureId) as MatchCenterResponse["momentum"];
  const aggregate=(clubId:number)=>{const count=(types:string[])=>rows.filter(e=>e.clubId===clubId&&types.includes(e.type)).length;return {shots:count(["GOAL","SAVE","MISS"]),shotsOnTarget:count(["GOAL","SAVE"]),goals:count(["GOAL"]),expectedGoals:rows.filter(e=>e.clubId===clubId&&["GOAL","SAVE","MISS"].includes(e.type)).reduce((sum,e)=>sum+(e.xg??0),0),fouls:count(["FOUL"]),yellowCards:count(["YELLOW_CARD"]),redCards:count(["RED_CARD"]),substitutions:count(["SUBSTITUTION"]),injuries:count(["INJURY"])};};
  return {fixture,playbackStatus:fixture.status==="COMPLETED"?"FINISHED":fixture.status==="IN_PROGRESS"?"PAUSED":"IDLE",teams:[{clubId:fixture.home.clubId,name:fixture.home.name,isHome:true,lineup:this.lineup(db,fixtureId,fixture.home.clubId)},{clubId:fixture.away.clubId,name:fixture.away.name,isHome:false,lineup:this.lineup(db,fixtureId,fixture.away.clubId)}],statistics:{home:aggregate(fixture.home.clubId),away:aggregate(fixture.away.clubId)},events:rows.map(e=>({id:e.id,fixtureId,minute:e.minute,addedTime:0,type:e.type,clubId:e.clubId,playerId:e.playerId,secondaryPlayerId:e.secondaryPlayerId,xg:e.xg,description:e.description})),momentum};
 }

}