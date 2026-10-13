import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { SqliteDatabase } from "../db/database.js";
import { openDatabase, validateDatabase } from "../db/database.js";
import { advanceStageRound, ensureFactoryWorld16 } from "./gameService.js";
import { installDataPackage, type DataPackage } from "./dataPackages.js";

export interface PersistedWorldScaleResult {
  clubs:number; players:number; rounds:number; fixtures:number; completedFixtures:number;
  setupMs:number; fullSeasonMs:number; totalMs:number; databaseBytes:number; seed:number; integrity:"ok";
}
function fileBytes(path:string):number {
  return [path,path+"-wal",path+"-shm"].reduce((n,p)=>{try{return n+statSync(p).size;}catch{return n;}},0);
}
function roundRobin(ids:number[]):Array<Array<{home:number;away:number}>> {
  if(ids.length<2||ids.length%2!==0)throw new Error("Persisted world scales must be even integers >= 2.");
  const rotation=[...ids],firstLeg:Array<Array<{home:number;away:number}>>=[];
  for(let round=0;round<rotation.length-1;round++){
    const games:Array<{home:number;away:number}>=[];
    for(let i=0;i<rotation.length/2;i++){
      const a=rotation[i]!,b=rotation[rotation.length-1-i]!;
      games.push((round+i)%2===0?{home:a,away:b}:{home:b,away:a});
    }
    firstLeg.push(games);
    const fixed=rotation[0]!,last=rotation.pop()!;
    rotation.splice(1,0,last);rotation[0]=fixed;
  }
  return [...firstLeg,...firstLeg.map(games=>games.map(m=>({home:m.away,away:m.home})))];
}
function createPersistedWorld(db:SqliteDatabase,target:number,seed:number):{stageId:number;clubIds:number[];players:number;fixtures:number;rounds:number}{
  const currentClubCount=(db.prepare("SELECT COUNT(*) AS n FROM club").get() as {n:number}).n;
  if(currentClubCount<=16) ensureFactoryWorld16(db);
  const original=(db.prepare("SELECT id FROM club ORDER BY id").all() as Array<{id:number}>).map(c=>c.id);
  if(original.length>target)throw new Error(`Source save has ${original.length} clubs; requested benchmark scale is ${target}. Use a save with no more than the target club count.`);
  const firstClub=(db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM club").get() as {id:number}).id;
  const firstPerson=(db.prepare("SELECT COALESCE(MAX(id),0)+1 AS id FROM person").get() as {id:number}).id;
  const playerCols=(db.pragma("table_info(player)") as Array<{name:string}>).map(c=>c.name).filter(n=>n!=="person_id");
  const attrCols=(db.pragma("table_info(player_attribute)") as Array<{name:string}>).map(c=>c.name).filter(n=>n!=="player_id");
  const tacticCols=(db.pragma("table_info(team_tactic)") as Array<{name:string}>).map(c=>c.name).filter(n=>n!=="club_id");
  const insertClub=db.prepare("INSERT INTO club(id,nation_id,city_id,name,short_name,reputation,primary_color,secondary_color) SELECT ?,nation_id,city_id,?,?,?,primary_color,secondary_color FROM club WHERE id=?");
  const insertStadium=db.prepare("INSERT INTO stadium(club_id,city_id,name,capacity,pitch_quality) SELECT ?,city_id,?,capacity,pitch_quality FROM stadium WHERE club_id=? ORDER BY id LIMIT 1");
  const insertTactic=db.prepare(`INSERT INTO team_tactic(club_id,${tacticCols.join(",")}) SELECT ?,${tacticCols.join(",")} FROM team_tactic WHERE club_id=?`);
  const insertPerson=db.prepare("INSERT INTO person(id,full_name,birth_date,nationality_id) SELECT ?,?,birth_date,nationality_id FROM person WHERE id=?");
  const insertPlayer=db.prepare(`INSERT INTO player(person_id,${playerCols.join(",")}) SELECT ?,${playerCols.join(",")} FROM player WHERE person_id=?`);
  const insertAttr=db.prepare(`INSERT INTO player_attribute(player_id,${attrCols.join(",")}) SELECT ?,${attrCols.join(",")} FROM player_attribute WHERE player_id=?`);
  const insertPositions=db.prepare("INSERT INTO player_position(player_id,position_code,rating) SELECT ?,position_code,rating FROM player_position WHERE player_id=?");
  const insertMembership=db.prepare("INSERT INTO squad_membership(player_id,club_id,shirt_number,squad_status) VALUES(?,?,?,'FIRST_TEAM')");
  const insertCondition=db.prepare("INSERT INTO player_condition(player_id,energy,morale,sharpness,injured_until,suspension_matches) SELECT ?,energy,morale,sharpness,NULL,0 FROM player_condition WHERE player_id=?");
  const squad=db.prepare("SELECT sm.player_id AS playerId,sm.shirt_number AS shirtNumber FROM squad_membership sm WHERE sm.club_id=? ORDER BY sm.shirt_number,sm.player_id");
  const ids=[...original];let personId=firstPerson;
  db.transaction(()=>{
    while(ids.length<target){
      const index=ids.length-original.length,clubId=firstClub+index,source=original[index%original.length]!;
      const sourceClub=db.prepare("SELECT name,reputation FROM club WHERE id=?").get(source) as {name:string;reputation:number};
      insertClub.run(clubId,`Benchmark ${target} Club ${clubId}`,`B${clubId}`,Math.max(1,Math.min(100,sourceClub.reputation+(index%7)-3)),source);
      insertStadium.run(clubId,`Benchmark Stadium ${clubId}`,source);insertTactic.run(clubId,source);
      for(const player of squad.all(source) as Array<{playerId:number;shirtNumber:number}>){
        const id=personId++;
        insertPerson.run(id,`Benchmark Player ${id}`,player.playerId);insertPlayer.run(id,player.playerId);
        insertAttr.run(id,player.playerId);insertPositions.run(id,player.playerId);
        insertMembership.run(id,clubId,player.shirtNumber);insertCondition.run(id,player.playerId);
      }
      ids.push(clubId);
    }
  })();
  const competitionId=Number(db.prepare("INSERT INTO competition(nation_id,name,code,competition_kind) VALUES((SELECT nation_id FROM club WHERE id=?),?,?, 'LEAGUE')").run(ids[0],`Persisted Benchmark ${target}`,`PB${target}_${seed}`).lastInsertRowid);
  const seasonId=Number(db.prepare("INSERT INTO competition_season(competition_id,season_year,start_date,end_date,status) VALUES(?,2027,'2027-01-01','2037-12-31','PLANNED')").run(competitionId).lastInsertRowid);
  const stageId=Number(db.prepare("INSERT INTO competition_stage(season_id,name,stage_order,stage_kind) VALUES(?,'League',1,'LEAGUE')").run(seasonId).lastInsertRowid);
  db.prepare("INSERT INTO stage_format(stage_id,group_count,legs,home_away,win_points,draw_points,loss_points) VALUES(?,1,2,1,3,1,0)").run(stageId);
  const groupId=Number(db.prepare("INSERT INTO stage_group(stage_id,group_code,name,sort_order) VALUES(?,'A','League',1)").run(stageId).lastInsertRowid);
  const addParticipant=db.prepare("INSERT INTO stage_participant(stage_id,club_id,group_id,seed) VALUES(?,?,?,?)");
  const addStanding=db.prepare("INSERT INTO stage_standing(stage_id,club_id,group_id) VALUES(?,?,?)");
  ids.forEach((id,i)=>{addParticipant.run(stageId,id,groupId,i+1);addStanding.run(stageId,id,groupId);});
  const schedule=roundRobin(ids),addRound=db.prepare("INSERT INTO competition_round(stage_id,round_number,name,start_date,end_date) VALUES(?,?,?,?,?)");
  const addFixture=db.prepare("INSERT INTO fixture(round_id,home_club_id,away_club_id,stadium_id,scheduled_at,random_seed) VALUES(?,?,?,?,?,?)");
  db.transaction(()=>schedule.forEach((games,i)=>{
    const date=new Date(Date.UTC(2027,0,1+i*7)).toISOString().slice(0,10);
    const roundId=Number(addRound.run(stageId,i+1,`Round ${i+1}`,date,date).lastInsertRowid);
    games.forEach((m,j)=>{
      const stadium=db.prepare("SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1").get(m.home) as {id:number}|undefined;
      addFixture.run(roundId,m.home,m.away,stadium?.id??null,`${date}T${String(12+(j%6)*2).padStart(2,"0")}:00:00`,(seed+i*1000+j)>>>0);
    });
  }))();
  const playerCount=(db.prepare("SELECT COUNT(*) AS n FROM squad_membership WHERE club_id IN ("+ids.map(()=>"?").join(",")+")").get(...ids) as {n:number}).n;
  return {stageId,clubIds:ids,players:playerCount,fixtures:schedule.reduce((sum,r)=>sum+r.length,0),rounds:schedule.length};
}
async function benchmarkOne(source:SqliteDatabase,clubs:number,seed:number,packages:DataPackage[]):Promise<PersistedWorldScaleResult>{
  const dir=mkdtempSync(join(tmpdir(),"gm-persisted-world-")),path=join(dir,"world.sqlite"),started=performance.now();
  let db:SqliteDatabase|undefined;
  try{
    await source.backup(path);db=openDatabase(path);
    ensureFactoryWorld16(db);
    for(const pkg of packages) installDataPackage(db,pkg);
    const world=createPersistedWorld(db,clubs,seed),setupMs=performance.now()-started,seasonStart=performance.now();
    for(let round=1;round<=world.rounds;round++)advanceStageRound(db,world.stageId,round);
    const fullSeasonMs=performance.now()-seasonStart;
    const completed=(db.prepare("SELECT COUNT(*) AS n FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=? AND f.status='COMPLETED'").get(world.stageId) as {n:number}).n;
    if(completed!==world.fixtures)throw new Error(`Persisted-world season incomplete: ${completed}/${world.fixtures} fixtures completed.`);
    validateDatabase(db);
    return {clubs:world.clubIds.length,players:world.players,rounds:world.rounds,fixtures:world.fixtures,completedFixtures:completed,setupMs,fullSeasonMs,totalMs:performance.now()-started,databaseBytes:fileBytes(path),seed,integrity:"ok"};
  }finally{if(db?.open)db.close();rmSync(dir,{recursive:true,force:true});}
}
/** Full SQLite seasons with generated persistent squads, fixtures, events, conditions and standings. */
export async function runPersistedWorldBenchmarks(source:SqliteDatabase,scales=[16,64,256],seed=90210,packages:DataPackage[]=[]):Promise<PersistedWorldScaleResult[]>{
  if(!Number.isSafeInteger(seed)||seed<0)throw new Error("Seed must be a non-negative integer.");
  const unique=[...new Set(scales)];
  if(!unique.length||unique.some(n=>!Number.isSafeInteger(n)||n<16||n%2!==0))throw new Error("Persisted world scales must be unique even integers >= 16.");
  const results:PersistedWorldScaleResult[]=[];
  for(const scale of unique)results.push(await benchmarkOne(source,scale,seed,packages));
  return results;
}
