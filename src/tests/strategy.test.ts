import test from "node:test";
import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {openDatabase,validateDatabase} from "../db/database.js";
import {SaveManager} from "../save/saveManager.js";
import {previewLineup,saveLineup} from "../game/lineupService.js";
import {advanceNextFixture,advanceStageRound,ensureFactoryWorld16,getSeasonStatus,getStandings,listFixtures} from "../game/gameService.js";
import {summarizeSamples} from "../game/matchBalance.js";
import {runEngineDiagnostics,runMatchBalanceAnalysis,runTacticalImpactAnalysis} from "../game/matchEngine.js";
const schema=resolve("src/schema/game_manager_mvp.sql");
function setup(){const root=mkdtempSync(join(tmpdir(),"gmf-p2-"));const path=join(root,"master.sqlite");const db=openDatabase(path);db.exec(readFileSync(schema,"utf8"));validateDatabase(db);db.close();return{root,masterPath:path,manager:new SaveManager(path,join(root,"saves"))};}
async function campaign(){const s=setup();const save=await s.manager.create({name:"test",managerName:"test",clubId:1});return{...s,save,db:s.manager.open(save.filePath)};}
test("lineup preview provides 11 distinct starters including a goalkeeper and at most seven substitutes",async()=>{const x=await campaign();try{const l=previewLineup(x.db,1,1);assert.equal(l.starters.length,11);assert.equal(new Set(l.starters.map(p=>p.playerId)).size,11);assert.equal(l.starters.filter(p=>p.position==="GK").length,1);assert.ok(l.bench.length<=7);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
test("custom lineup rejects wrong counts, duplicate players and missing goalkeeper, then persists valid XI",async()=>{const x=await campaign();try{const l=previewLineup(x.db,1,1);assert.throws(()=>saveLineup(x.db,1,1,l.starters.slice(1).map(p=>p.playerId)),/exactly 11/);assert.throws(()=>saveLineup(x.db,1,1,[...l.starters.slice(1).map(p=>p.playerId),l.starters[1]!.playerId]),/twice/);const withoutKeeper=l.starters.filter(p=>p.position!=="GK").map(p=>p.playerId);withoutKeeper.push(12);assert.throws(()=>saveLineup(x.db,1,1,withoutKeeper),/exactly one goalkeeper/);saveLineup(x.db,1,1,l.starters.map(p=>p.playerId),l.bench.map(p=>p.playerId));assert.equal((x.db.prepare("SELECT COUNT(*) c FROM match_lineup WHERE fixture_id=1 AND club_id=1 AND is_starting=1").get() as {c:number}).c,11);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
test("match records events, checkpoint, momentum scores and individual fatigue",async()=>{const x=await campaign();try{const before=(x.db.prepare("SELECT energy FROM player_condition WHERE player_id=1").get() as {energy:number}).energy;const result=advanceNextFixture(x.db,1);assert.equal(result.minutes,90);assert.ok(result.homeShots+result.awayShots>=0);assert.equal((x.db.prepare("SELECT COUNT(*) c FROM match_momentum WHERE fixture_id=1").get() as {c:number}).c,90);const goals=(x.db.prepare("SELECT COUNT(*) c FROM match_event WHERE fixture_id=1 AND event_type='GOAL'").get() as {c:number}).c;assert.equal(goals,result.homeScore+result.awayScore);assert.ok((x.db.prepare("SELECT COUNT(*) c FROM match_player_state WHERE fixture_id=1").get() as {c:number}).c>=18);assert.ok((x.db.prepare("SELECT energy FROM player_condition WHERE player_id=1").get() as {energy:number}).energy<=before);const shots=(x.db.prepare("SELECT COUNT(*) c FROM match_event WHERE fixture_id=1 AND club_id=1 AND event_type IN ('GOAL','SAVE','MISS')").get() as {c:number}).c;assert.equal(result.homeShots,shots);const onTarget=(x.db.prepare("SELECT COUNT(*) c FROM match_event WHERE fixture_id=1 AND club_id=1 AND event_type IN ('GOAL','SAVE')").get() as {c:number}).c;assert.equal(result.homeShotsOnTarget,onTarget);const checkpoint=x.db.prepare("SELECT simulation_minute,state_json FROM match_simulation_state WHERE fixture_id=1").get() as {simulation_minute:number;state_json:string};assert.equal(checkpoint.simulation_minute,90);assert.equal(JSON.parse(checkpoint.state_json).completed,true);const momentum=x.db.prepare("SELECT minute,home_score,away_score FROM match_momentum WHERE fixture_id=1 ORDER BY minute").all() as Array<{minute:number;home_score:number;away_score:number}>;assert.ok(momentum.every(m=>m.home_score===(x.db.prepare("SELECT COUNT(*) c FROM match_event WHERE fixture_id=1 AND event_type='GOAL' AND club_id=1 AND minute<=?").get(m.minute) as {c:number}).c&&m.away_score===(x.db.prepare("SELECT COUNT(*) c FROM match_event WHERE fixture_id=1 AND event_type='GOAL' AND club_id=2 AND minute<=?").get(m.minute) as {c:number}).c));}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});
test("an interrupted fixture resumes from its persisted minute-zero checkpoint",async()=>{const x=await campaign();try{x.db.prepare("UPDATE fixture SET status='IN_PROGRESS',current_minute=0 WHERE id=1").run();x.db.prepare("INSERT INTO match_event(fixture_id,minute,event_type,xg,description) VALUES(?,0,'KICK_OFF',0,'Partida iniciada')").run(1);x.db.prepare("INSERT INTO match_simulation_state(fixture_id,state_version,simulation_minute,state_json) VALUES(?,1,0,?)").run(1,JSON.stringify({seed:((x.db.prepare("SELECT random_seed FROM fixture WHERE id=1").get() as {random_seed:number|null}).random_seed??2654435761),minute:0,homeScore:0,awayScore:0,completed:false}));const result=advanceNextFixture(x.db,1);assert.equal(result.minutes,90);assert.equal((x.db.prepare("SELECT status FROM fixture WHERE id=1").get() as {status:string}).status,"COMPLETED");assert.equal((x.db.prepare("SELECT simulation_minute FROM match_simulation_state WHERE fixture_id=1").get() as {simulation_minute:number}).simulation_minute,90);assert.equal((x.db.prepare("SELECT COUNT(*) c FROM match_momentum WHERE fixture_id=1").get() as {c:number}).c,90);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});

test("Monte Carlo summaries aggregate 5,000 samples and probabilities sum to one",()=>{const samples=Array.from({length:5000},(_,i)=>({homeGoals:i%3===0?2:1,awayGoals:i%5===0?2:0,homeShots:10,awayShots:8}));const r=summarizeSamples(samples);assert.equal(r.simulations,5000);assert.ok(Math.abs(r.homeWinRate+r.drawRate+r.awayWinRate-1)<1e-10);assert.equal(r.averageTotalGoals,r.averageHomeGoals+r.averageAwayGoals);});

test("engine Monte Carlo uses the calibrated shared kernel over five thousand seeded matches",async()=>{const x=await campaign();try{const r=runMatchBalanceAnalysis(x.db,1,2,5000);assert.equal(r.simulations,5000);assert.ok(Math.abs(r.homeWinRate+r.drawRate+r.awayWinRate-1)<1e-10);assert.ok(r.averageTotalShots>=20&&r.averageTotalShots<=28,`total shots out of target: ${r.averageTotalShots}`);assert.ok(r.averageTotalShotsOnTarget>=6.5&&r.averageTotalShotsOnTarget<=10,`shots on target out of target: ${r.averageTotalShotsOnTarget}`);assert.ok(r.averageTotalXg>=2.0&&r.averageTotalXg<=3.3,`xG out of target: ${r.averageTotalXg}`);assert.ok(r.averageTotalGoals>=1.8&&r.averageTotalGoals<=3.5,`goals out of target: ${r.averageTotalGoals}`);assert.ok(r.goallessRate>=0&&r.goallessRate<=1);assert.ok(r.anyTeamFivePlusGoalsRate>=0&&r.anyTeamFivePlusGoalsRate<=1);assert.ok(r.sixPlusTotalGoalsRate>=0&&r.sixPlusTotalGoalsRate<=1);assert.ok(r.maxTeamGoals>=0&&r.maxTotalGoals>=r.maxTeamGoals);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});

test("aggressive tactics have a measurable effect while the model remains stochastic",async()=>{const x=await campaign();try{const baseline=runMatchBalanceAnalysis(x.db,1,2,5000,991);x.db.prepare("UPDATE team_tactic SET mentality='VERY_ATTACKING',pressing=100,tempo=100,defensive_line=90 WHERE club_id=1").run();const aggressive=runMatchBalanceAnalysis(x.db,1,2,5000,991);assert.ok(aggressive.averageHomeGoals>baseline.averageHomeGoals||aggressive.homeShotRate>baseline.homeShotRate);assert.ok(aggressive.homeWinRate>0);assert.ok(aggressive.drawRate>0);assert.ok(aggressive.awayWinRate>0);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});

test("engine diagnostics report xG distribution, side-swap, strength gap, and persisted-match consistency",async()=>{const x=await campaign();try{const r=runEngineDiagnostics(x.db,500,321);assert.equal(r.simulations,500);assert.ok(r.xgBands.length>=4);assert.ok(r.xgBands.reduce((n,b)=>n+b.shots,0)>0);assert.ok(r.xgBands.every(b=>b.averageXg>=0&&b.onTargetRate>=0&&b.onTargetRate<=1&&b.goalRate>=0&&b.saveRate>=0&&b.missRate>=0&&Math.abs(b.goalRate+b.saveRate+b.missRate-1)<1e-9));assert.ok(r.homeAdvantage.homeAdvantageDelta>=-1&&r.homeAdvantage.homeAdvantageDelta<=1);assert.ok(r.strengthGap.strongStrength>=r.strengthGap.weakStrength);assert.equal(r.persistedMatches.checked,0);assert.deepEqual(r.persistedMatches.issues,[]);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});

test("xG diagnostics include clear chances and side-swapped simulations use paired club RNG streams",async()=>{const x=await campaign();try{const r=runEngineDiagnostics(x.db,1000,912);assert.ok(r.xgBands.find(b=>b.band==="0.20+")!.shots>0,"expected high-xG shots in diagnostics");assert.ok(r.xgBands.every(b=>Math.abs(b.goalRate+b.saveRate+b.missRate-1)<1e-9));assert.equal(r.homeAdvantage.shotChanceBonus,0.004,"home advantage is an explicit calibrated modifier");assert.ok(Math.abs(r.homeAdvantage.homeAdvantageDelta)<=0.10,"paired home/away estimate should remain within a plausible Monte Carlo range");assert.ok(r.strengthGap.strengthDifference>=0);assert.equal(r.strengthGap.hasMeaningfulGap,r.strengthGap.strengthDifference>=8);}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});

test("tactical impact scenarios are seeded, comparable, and do not mutate saved tactics",async()=>{const x=await campaign();try{const before=x.db.prepare("SELECT mentality,pressing,tempo,defensive_line FROM team_tactic WHERE club_id=1").get() as {mentality:string;pressing:number;tempo:number;defensive_line:number};const a=runTacticalImpactAnalysis(x.db,1,2,1500,5541);const b=runTacticalImpactAnalysis(x.db,1,2,1500,5541);assert.deepEqual(a,b,"identical seeds and saved tactics must produce identical reports");assert.deepEqual(a.scenarios.map(s=>s.name),["baseline","home_attacking","home_defensive","away_high_press"]);const aggressive=a.scenarios.find(s=>s.name==="home_attacking")!;assert.ok(aggressive.homeShotsDelta>0||aggressive.averageHomeGoalsDelta>0,"attacking tactic should measurably increase shot volume or goals");assert.ok(a.scenarios.some(s=>s.name!=="baseline"&&(s.homeWinRateDelta!==0||s.averageTotalXgDelta!==0)));const after=x.db.prepare("SELECT mentality,pressing,tempo,defensive_line FROM team_tactic WHERE club_id=1").get();assert.deepEqual(after,before,"analysis must not persist scenario overrides");}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});

test("controlled favorite-underdog matchup validates an 8+ strength gap and tactical impact without changing global balance",async()=>{const x=await campaign();try{
 const attributes=["pace","acceleration","stamina","strength","agility","positioning","anticipation","decisions","composure","teamwork","work_rate","passing","vision","crossing","dribbling","finishing","long_shots","heading","tackling","marking","aggression","concentration","reflexes","handling","aerial_reach"];
 const setClubLevel=(clubId:number,level:number)=>{const assignments=attributes.map(name=>name+"=?").join(",");x.db.prepare("UPDATE player_attribute SET "+assignments+" WHERE player_id IN (SELECT player_id FROM squad_membership WHERE club_id=?)").run(...attributes.map(()=>level),clubId);x.db.prepare("UPDATE player_position SET rating=? WHERE player_id IN (SELECT player_id FROM squad_membership WHERE club_id=?)").run(level,clubId);};
 // Synthetic test data lives only in this disposable campaign DB; no factory data or global coefficients are changed.
 for(const row of x.db.prepare("SELECT id FROM club").all() as Array<{id:number}>)setClubLevel(row.id,row.id===1?90:15);
 const diagnostics=runEngineDiagnostics(x.db,5000,73421);
 assert.equal(diagnostics.strengthGap.hasMeaningfulGap,true,JSON.stringify(diagnostics.strengthGap));
 assert.ok(diagnostics.strengthGap.strengthDifference>=8,JSON.stringify(diagnostics.strengthGap));
 const favoriteId=diagnostics.strengthGap.strongClubId,underdogId=diagnostics.strengthGap.weakClubId;
 const report=runTacticalImpactAnalysis(x.db,favoriteId,underdogId,5000,73421);
 const baseline=report.scenarios.find(s=>s.name==="baseline")!.result;
 assert.ok(baseline.homeWinRate>baseline.awayWinRate,JSON.stringify({favoriteId,underdogId,baseline,strengthGap:diagnostics.strengthGap}));
 assert.ok(baseline.awayWinRate>0,"underdog must retain a non-zero upset probability");
 assert.equal(report.scenarios.length,4);
 assert.ok(report.scenarios.some(s=>s.name!=="baseline"&&(s.homeWinRateDelta!==0||s.averageTotalXgDelta!==0)),"tactical overrides should alter the controlled matchup");
 const repeat=runTacticalImpactAnalysis(x.db,favoriteId,underdogId,5000,73421);
 assert.deepEqual(repeat,report,"fixed matchup and seed must be reproducible");
}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});


test("exceptional goalkeeper measurably reduces opponent conversion on paired seeds",async()=>{const x=await campaign();try{
 const baseline=runMatchBalanceAnalysis(x.db,1,2,5000,88127);
 const keeper=(x.db.prepare("SELECT sm.player_id AS id FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id WHERE sm.club_id=2 AND p.goalkeeper=1 ORDER BY sm.shirt_number LIMIT 1").get() as {id:number});
 x.db.prepare("UPDATE player_attribute SET reflexes=100,handling=100,positioning=100,concentration=100,aerial_reach=100 WHERE player_id=?").run(keeper.id);
 const inspired=runMatchBalanceAnalysis(x.db,1,2,5000,88127);
 assert.ok(inspired.averageHomeGoals<baseline.averageHomeGoals,JSON.stringify({baseline:baseline.averageHomeGoals,inspired:inspired.averageHomeGoals}));
 assert.ok(inspired.homeShotRate>=baseline.homeShotRate-0.5,"keeper quality must affect conversion, not erase shot creation");
}finally{x.db.close();rmSync(x.root,{recursive:true,force:true});}});

test("factory world upgrade creates a playable 16-club league and knockout cup, then completes a measured season",async()=>{const s=setup();let master=openDatabase(s.masterPath);let db:ReturnType<typeof openDatabase>|undefined;try{
 const upgraded=ensureFactoryWorld16(master);
 assert.deepEqual(upgraded,{upgraded:true,clubs:16,leagueFixtures:240,cupEntrants:16});
 assert.deepEqual(ensureFactoryWorld16(master),{upgraded:false,clubs:16,leagueFixtures:240,cupEntrants:16});
 validateDatabase(master);
 master.close();
 const save=await s.manager.create({name:"16 club benchmark",managerName:"Test",clubId:1});
 db=s.manager.open(save.filePath);
 assert.equal((db.prepare("SELECT COUNT(*) AS count FROM club").get() as {count:number}).count,16);
 assert.equal(listFixtures(db).filter(f=>f.competition==="Liga Nacional de Teste").length,240);
 assert.equal(listFixtures(db).filter(f=>f.competition==="Copa Nacional de Teste").length,8);
 assert.equal((db.prepare("SELECT COUNT(*) AS count FROM competition_round WHERE stage_id=1").get() as {count:number}).count,30);
 for(let round=1;round<=30;round++) assert.equal(advanceStageRound(db,1,round).length,8);
 const standings=getStandings(db,1);
 assert.equal(standings.length,16);
 assert.ok(standings.every(row=>row.played===30));
 assert.equal(getSeasonStatus(db,1)[0]?.seasonStatus,"COMPLETED");
 let cupRound=1,cupMatches=0;
 while(true){
   const row=db.prepare("SELECT id FROM competition_round WHERE stage_id=2 AND round_number=?").get(cupRound) as {id:number}|undefined;
   if(!row) break;
   const matches=(db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE round_id=? AND status='SCHEDULED'").get(row.id) as {count:number}).count;
   if(matches===0) break;
   cupMatches+=advanceStageRound(db,2,cupRound).length;
   cupRound++;
 }
 assert.equal(cupMatches,15);
 assert.equal(getSeasonStatus(db,2)[0]?.seasonStatus,"COMPLETED");
 assert.equal((db.prepare("SELECT COUNT(*) AS count FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=2 AND f.status='COMPLETED'").get() as {count:number}).count,15);
 const integrity=db.pragma("integrity_check",{simple:true});
 assert.equal(integrity,"ok");
 const fk=db.pragma("foreign_key_check");
 assert.deepEqual(fk,[]);
 console.log("Phase 5 benchmark: 16 clubs, 240 league fixtures + 15 cup fixtures completed in "+Math.round(performance.now())+" ms elapsed test time.");
}finally{if(db?.open)db.close();if(master.open)master.close();rmSync(s.root,{recursive:true,force:true});}});
