import {masterPath,saveDir} from "../../client/config.js";
import type {SqliteDatabase} from "../../db/database.js";
import {SaveManager} from "../../save/saveManager.js";
import {getManagedClub} from "../../game/clubService.js";
import {listFixtures} from "../../game/fixtureService.js";
import {listSquad,getTactics} from "../../game/squadService.js";
import {getSeasonStatus} from "../../game/competition/competitionService.js";
import {getStandings} from "../../game/competition/standingsService.js";
import type {CampaignClubDto,CampaignOverviewResponse,CampaignCalendarResponse,CampaignSquadResponse,CampaignTeamResponse} from "../../../shared/src/index.js";
import type {CampaignRepository} from "./campaign.repository.js";
import {SaveNotFoundError} from "../saves/save-not-found.error.js";
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
}