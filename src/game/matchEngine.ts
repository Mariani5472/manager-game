import type { SqliteDatabase } from "../db/database.js";
export interface MatchSummary {fixtureId:number;homeClubId:number;awayClubId:number;homeScore:number;awayScore:number;events:number;minutes:number;homeShots:number;awayShots:number;homeShotsOnTarget:number;awayShotsOnTarget:number;homeXg:number;awayXg:number;}
interface FixtureRow{id:number;home_club_id:number;away_club_id:number;random_seed:number|null;status:string;}
export interface Player{id:number;name:string;goalkeeper:number;energy:number;morale:number;sharpness:number;pace:number;stamina:number;strength:number;positioning:number;decisions:number;composure:number;teamwork:number;work_rate:number;passing:number;vision:number;crossing:number;dribbling:number;finishing:number;long_shots:number;heading:number;tackling:number;marking:number;aggression:number;concentration:number;reflexes:number;handling:number;aerial_reach:number;}
export interface Tactic{formation_id:number;mentality:string;pressing:number;tempo:number;defensive_line:number;width:number;passing_directness:number;counter_attack:number;}
export interface MatchPlayer extends Player{role:string;slot:number;isStarting:boolean;positionRating:number;}
export interface Team{clubId:number;reputation:number;tactic:Tactic;lineup:MatchPlayer[];attacking:number;defending:number;goalkeeping:number;energy:number;fitness:number;}
export interface SimulatedMatchResult{homeScore:number;awayScore:number;homeShots:number;awayShots:number;homeShotsOnTarget:number;awayShotsOnTarget:number;homeXg:number;awayXg:number;}
export interface MonteCarloReport{simulations:number;homeWinRate:number;drawRate:number;awayWinRate:number;averageHomeGoals:number;averageAwayGoals:number;averageTotalGoals:number;homeShotRate:number;awayShotRate:number;averageTotalShots:number;averageTotalShotsOnTarget:number;averageTotalXg:number;meanAbsoluteGoalDifference:number;goallessRate:number;anyTeamFivePlusGoalsRate:number;sixPlusTotalGoalsRate:number;homeWinByThreePlusRate:number;awayWinByThreePlusRate:number;maxTeamGoals:number;maxTotalGoals:number;}
function rng(seed:number):()=>number{let s=seed>>>0;return()=>{s+=0x6D2B79F5;let v=s;v=Math.imul(v^(v>>>15),v|1);v^=v+Math.imul(v^(v>>>7),v|61);return((v^(v>>>14))>>>0)/4294967296;};}
function clamp(n:number,a:number,b:number):number{return Math.max(a,Math.min(b,n));}
function mean(xs:number[]):number{return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:50;}
const compatible:Record<string,string[]>={GK:["GK"],CB:["CB"],LB:["LB","LWB","RB"],RB:["RB","RWB","LB"],LWB:["LWB","LB","RWB"],RWB:["RWB","RB","LWB"],DM:["DM","CM"],CM:["CM","DM","AM"],AM:["AM","CM","ST"],LW:["LW","LM","RW","RM"],RW:["RW","RM","LW","LM"],LM:["LM","LW","RM","RW"],RM:["RM","RW","LM","LW"],ST:["ST","AM"]};
function fit(actual:string,required:string):number{return actual===required?1:(compatible[required]?.includes(actual)?0.82:0.48);}
function tactic(db:SqliteDatabase,clubId:number):Tactic{const t=db.prepare("SELECT formation_id,mentality,pressing,tempo,defensive_line,width,passing_directness,counter_attack FROM team_tactic WHERE club_id=?").get(clubId) as Tactic|undefined;if(!t)throw new Error(`Tactics for club ${clubId} were not found.`);return t;}
function loadPlayers(db:SqliteDatabase,clubId:number):Player[]{return db.prepare(`SELECT p.person_id AS id,pe.full_name AS name,p.goalkeeper,COALESCE(pc.energy,100) energy,COALESCE(pc.morale,50) morale,COALESCE(pc.sharpness,50) sharpness,pa.pace,pa.stamina,pa.strength,pa.positioning,pa.decisions,pa.composure,pa.teamwork,pa.work_rate,pa.passing,pa.vision,pa.crossing,pa.dribbling,pa.finishing,pa.long_shots,pa.heading,pa.tackling,pa.marking,pa.aggression,pa.concentration,pa.reflexes,pa.handling,pa.aerial_reach FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id JOIN person pe ON pe.id=p.person_id JOIN player_attribute pa ON pa.player_id=p.person_id LEFT JOIN player_condition pc ON pc.player_id=p.person_id WHERE sm.club_id=? AND COALESCE(pc.suspension_matches,0)=0 AND pc.injured_until IS NULL ORDER BY p.person_id`).all(clubId) as Player[];}
function loadPositions(db:SqliteDatabase,clubId:number):Map<number,Map<string,number>>{const rows=db.prepare("SELECT pp.player_id,pp.position_code,pp.rating FROM player_position pp JOIN squad_membership sm ON sm.player_id=pp.player_id WHERE sm.club_id=?").all(clubId) as Array<{player_id:number;position_code:string;rating:number}>;const out=new Map<number,Map<string,number>>();for(const r of rows){if(!out.has(r.player_id))out.set(r.player_id,new Map());out.get(r.player_id)!.set(r.position_code,r.rating);}return out;}
function bestPosition(id:number,positions:Map<number,Map<string,number>>):string{return [...(positions.get(id)?.entries()??[])].sort((a,b)=>b[1]-a[1])[0]?.[0]??"CM";}
function skill(p:Player,role:string):number{return role==="GK"?mean([p.reflexes,p.handling,p.positioning,p.concentration,p.aerial_reach]):["CB","LB","RB","LWB","RWB"].includes(role)?mean([p.tackling,p.marking,p.positioning,p.strength,p.pace]):["DM","CM","AM"].includes(role)?mean([p.passing,p.vision,p.decisions,p.teamwork,p.stamina]):["LW","RW","LM","RM"].includes(role)?mean([p.pace,p.dribbling,p.crossing,p.composure]):mean([p.finishing,p.composure,p.positioning,p.heading,p.decisions]);}
function selectLineup(db:SqliteDatabase,fixtureId:number,clubId:number,players:Player[],t:Tactic,persist=true):MatchPlayer[]{
 const slots=db.prepare("SELECT slot_number,position_code FROM formation_slot WHERE formation_id=? ORDER BY slot_number").all(t.formation_id) as Array<{slot_number:number;position_code:string}>;
 if(slots.length!==11)throw new Error(`Formation ${t.formation_id} must define exactly 11 slots; found ${slots.length}.`);
 if(players.length<11)throw new Error(`Club ${clubId} has fewer than eleven available players.`);
 const positions=loadPositions(db,clubId),byId=new Map(players.map(p=>[p.id,p]));
 const saved=db.prepare("SELECT player_id AS id,slot_number AS slot,position_code AS role,is_starting AS isStarting FROM match_lineup WHERE fixture_id=? AND club_id=? ORDER BY slot_number").all(fixtureId,clubId) as Array<{id:number;slot:number;role:string;isStarting:number}>;
 const existing=saved.filter(p=>p.isStarting===1);
 let starters:MatchPlayer[]=[];
 const valid=existing.length===11&&new Set(existing.map(p=>p.id)).size===11&&existing.every(p=>byId.has(p.id))&&existing.filter(p=>p.role==="GK"&&byId.get(p.id)?.goalkeeper===1).length===1&&slots.every(slot=>existing.some(p=>p.slot===slot.slot_number&&p.role===slot.position_code));
 if(valid){
  starters=existing.map(p=>({...byId.get(p.id)!,role:p.role,slot:p.slot,isStarting:true,positionRating:positions.get(p.id)?.get(p.role)??50}));
 }else{
  if(persist)db.prepare("DELETE FROM match_lineup WHERE fixture_id=? AND club_id=?").run(fixtureId,clubId);
  const used=new Set<number>();
  for(const slot of slots){
   const options=players.filter(p=>!used.has(p.id)).sort((a,b)=>{
    const score=(p:Player)=>{const rating=positions.get(p.id)?.get(slot.position_code)??50;return(rating*.48+skill(p,slot.position_code)*.32+p.energy*.08+p.morale*.06+p.sharpness*.06)*fit(bestPosition(p.id,positions),slot.position_code);};
    return score(b)-score(a)||a.id-b.id;
   });
   const p=options[0]!;used.add(p.id);starters.push({...p,role:slot.position_code,slot:slot.slot_number,isStarting:true,positionRating:positions.get(p.id)?.get(slot.position_code)??50});
  }
  if(starters.filter(p=>p.role==="GK"&&p.goalkeeper===1).length!==1)throw new Error("Formation must assign exactly one goalkeeper to its GK slot.");
  if(persist){const insert=db.prepare("INSERT INTO match_lineup(fixture_id,club_id,player_id,slot_number,is_starting,position_code) VALUES(?,?,?,?,1,?)");starters.forEach(p=>insert.run(fixtureId,clubId,p.id,p.slot,p.role));}
 }
 const startersIds=new Set(starters.map(p=>p.id));
 const savedBench=saved.filter(p=>p.isStarting===0&&byId.has(p.id)&&!startersIds.has(p.id)).slice(0,7);
 const bench:MatchPlayer[]=savedBench.length?savedBench.map(p=>({...byId.get(p.id)!,role:p.role,slot:p.slot,isStarting:false,positionRating:positions.get(p.id)?.get(p.role)??50})):
  players.filter(p=>!startersIds.has(p.id)).sort((a,b)=>(skill(b,bestPosition(b.id,positions))+b.energy*.3+b.morale*.2)-(skill(a,bestPosition(a.id,positions))+a.energy*.3+a.morale*.2)).slice(0,7).map((p,i)=>({...p,role:bestPosition(p.id,positions),slot:12+i,isStarting:false,positionRating:positions.get(p.id)?.get(bestPosition(p.id,positions))??50}));
 if(persist){const insert=db.prepare("INSERT INTO match_lineup(fixture_id,club_id,player_id,slot_number,is_starting,position_code) VALUES(?,?,?,?,0,?)");for(const p of bench)if(!saved.some(s=>s.id===p.id&&s.isStarting===0))insert.run(fixtureId,clubId,p.id,p.slot,p.role);}
 return [...starters,...bench];
}
function loadTeam(db:SqliteDatabase,fixtureId:number,clubId:number,persistLineup=true):Team{const c=db.prepare("SELECT reputation FROM club WHERE id=?").get(clubId) as {reputation:number}|undefined;if(!c)throw new Error(`Club ${clubId} not found.`);const t=tactic(db,clubId),players=loadPlayers(db,clubId),lineup=selectLineup(db,fixtureId,clubId,players,t,persistLineup),s=lineup.filter(p=>p.isStarting);const posRating=mean(s.map(p=>p.positionRating*fit(bestPosition(p.id,loadPositions(db,clubId)),p.role)));const attacking=mean(s.map(p=>skill(p,p.role)*.72+p.positionRating*.28+p.energy*.18+p.morale*.08+p.sharpness*.08));const defending=mean(s.map(p=>mean([p.tackling,p.marking,p.positioning,p.concentration,p.strength])));const keeper=s.find(p=>p.role==="GK");return{clubId,reputation:c.reputation,tactic:t,lineup,attacking:attacking+(posRating-50)*.15,defending,goalkeeping:keeper?mean([keeper.reflexes,keeper.handling,keeper.aerial_reach,keeper.positioning]):45,energy:mean(s.map(p=>p.energy)),fitness:mean(s.map(p=>p.stamina))};}
interface KernelShotEvent {
 minute:number; clubId:number; playerId:number; secondaryPlayerId:number|null;
 eventType:"GOAL"|"SAVE"|"MISS"; xg:number; description:string;
}
interface KernelMinute {
 minute:number; homePressure:number; awayPressure:number; homeScore:number; awayScore:number;
 events:KernelShotEvent[];
}
interface KernelTimeline {result:SimulatedMatchResult; events:KernelShotEvent[]; minutes:KernelMinute[];}
const HOME_SHOT_CHANCE_BONUS=0.004; // +0.4 percentage points per minute: modest, isolated home advantage.
function mentalityShotModifier(value:string):number {
 return ({"VERY_DEFENSIVE":-.018,"DEFENSIVE":-.009,"BALANCED":0,"ATTACKING":.009,"VERY_ATTACKING":.018}[value]??0);
}
function teamPressure(team:Team, random:()=>number):number {
 const mentality={"VERY_DEFENSIVE":-5,"DEFENSIVE":-2,"BALANCED":0,"ATTACKING":3,"VERY_ATTACKING":5}[team.tactic.mentality]??0;
 return clamp(team.attacking*.43+team.tactic.pressing*.16+team.tactic.tempo*.10+
  team.tactic.defensive_line*.04+mentality+random()*8,0,100);
}
function simulateMatchTimeline(home:Team,away:Team,seed:number):KernelTimeline {
 // Random streams are tied to club identity, not home/away slot. This makes side-swapped
 // diagnostics a paired comparison rather than a comparison polluted by RNG draw order.
 const homeRandom=rng(seed ^ Math.imul(home.clubId,0x9e3779b1));
 const awayRandom=rng(seed ^ Math.imul(away.clubId,0x9e3779b1));
 let hs=0,as=0,hShots=0,aShots=0,hOn=0,aOn=0,hxg=0,axg=0;
 const events:KernelShotEvent[]=[];
 const minutes:KernelMinute[]=[];
 for(let minute=1;minute<=90;minute++){
  const hp=teamPressure(home,homeRandom),ap=teamPressure(away,awayRandom);
  const minuteEvents:KernelShotEvent[]=[];
  for(const side of [{team:home,opponent:away,isHome:true,pressure:hp,opponentPressure:ap,random:homeRandom},
                      {team:away,opponent:home,isHome:false,pressure:ap,opponentPressure:hp,random:awayRandom}]){
   const tactic=side.team.tactic;
   const chance=clamp(.095+(side.team.attacking-50)*.0011+(50-side.opponent.defending)*.00045+
    mentalityShotModifier(tactic.mentality)+(tactic.pressing-50)*.00012+
    (tactic.tempo-50)*.00012+(side.pressure-side.opponentPressure)*.00012+
    (tactic.counter_attack?.004:0)+(side.isHome?HOME_SHOT_CHANCE_BONUS:0),.055,.19);
   if(side.random()>=chance)continue;
   const attackers=side.team.lineup.filter(p=>p.isStarting&&p.role!=="GK");
   if(!attackers.length)throw new Error(`Club ${side.team.clubId} has no available outfield starters.`);
   const shooter=attackers[Math.floor(side.random()*attackers.length)]!;
   const keeper=side.opponent.lineup.find(p=>p.isStarting&&p.role==="GK");
   if(!keeper)throw new Error(`Club ${side.opponent.clubId} has no starting goalkeeper.`);
   const keeperSkill=mean([keeper.reflexes,keeper.handling,keeper.positioning,keeper.concentration]);
   // Sample shot quality from low-, medium-, and high-quality chance profiles.
   // The mixture retains a similar average xG while making clear chances observable in diagnostics.
   const qualityRoll=side.random();
   const baseXg=qualityRoll<.56 ? .035+side.random()*.06 :
    qualityRoll<.92 ? .095+side.random()*.075 : .17+side.random()*.15;
   const xg=clamp(baseXg+(side.team.attacking-50)*.0002+
    (shooter.finishing-50)*.0001+(tactic.tempo-50)*.00003,.025,.35);
   const onTargetChance=clamp(.29+xg*.5,.30,.48);
   const onTarget=side.random()<onTargetChance;
   const keeperFactor=clamp(1+(50-keeperSkill)*.006,.70,1.30);
   const goal=onTarget&&side.random()<clamp((xg/onTargetChance)*keeperFactor,.015,.82);
   const event:KernelShotEvent={
    minute,clubId:side.team.clubId,playerId:shooter.id,secondaryPlayerId:onTarget?keeper.id:null,
    eventType:goal?"GOAL":onTarget?"SAVE":"MISS",xg,
    description:goal?`Gol de ${shooter.name}`:onTarget?`Defesa de ${keeper.name} após finalização de ${shooter.name}`:`Finalização de ${shooter.name} para fora`
   };
   minuteEvents.push(event);events.push(event);
   if(side.isHome){hShots++;hxg+=xg;if(onTarget)hOn++;if(goal)hs++;}
   else{aShots++;axg+=xg;if(onTarget)aOn++;if(goal)as++;}
  }
  minutes.push({minute,homePressure:hp,awayPressure:ap,homeScore:hs,awayScore:as,events:minuteEvents});
 }
 return {events,minutes,result:{homeScore:hs,awayScore:as,homeShots:hShots,awayShots:aShots,
  homeShotsOnTarget:hOn,awayShotsOnTarget:aOn,homeXg:hxg,awayXg:axg}};
}
export function simulateMatchKernel(home:Team,away:Team,seed:number):SimulatedMatchResult {
 return simulateMatchTimeline(home,away,seed).result;
}
export function runMonteCarlo(home:Team,away:Team,simulations=5000,seed=73421):MonteCarloReport {
 if(!Number.isSafeInteger(simulations)||simulations<100)throw new Error("Monte Carlo simulations must be an integer >= 100.");
 let hw=0,d=0,aw=0,hg=0,ag=0,hs=0,as=0,hon=0,aon=0,hxg=0,axg=0,diff=0;
 let goalless=0,anyFivePlus=0,sixPlusTotal=0,homeByThree=0,awayByThree=0,maxTeamGoals=0,maxTotalGoals=0;
 for(let i=0;i<simulations;i++){
  const r=simulateMatchTimeline(home,away,seed+i*7919).result;
  if(r.homeScore>r.awayScore)hw++;else if(r.homeScore===r.awayScore)d++;else aw++;
  hg+=r.homeScore;ag+=r.awayScore;hs+=r.homeShots;as+=r.awayShots;
  hon+=r.homeShotsOnTarget;aon+=r.awayShotsOnTarget;hxg+=r.homeXg;axg+=r.awayXg;
  diff+=Math.abs(r.homeScore-r.awayScore);
  const total=r.homeScore+r.awayScore;
  if(total===0)goalless++;
  if(Math.max(r.homeScore,r.awayScore)>=5)anyFivePlus++;
  if(total>=6)sixPlusTotal++;
  if(r.homeScore-r.awayScore>=3)homeByThree++;
  if(r.awayScore-r.homeScore>=3)awayByThree++;
  maxTeamGoals=Math.max(maxTeamGoals,r.homeScore,r.awayScore);
  maxTotalGoals=Math.max(maxTotalGoals,total);
 }
 return {simulations,homeWinRate:hw/simulations,drawRate:d/simulations,awayWinRate:aw/simulations,
  averageHomeGoals:hg/simulations,averageAwayGoals:ag/simulations,averageTotalGoals:(hg+ag)/simulations,
  homeShotRate:hs/simulations,awayShotRate:as/simulations,
  averageTotalShots:(hs+as)/simulations,averageTotalShotsOnTarget:(hon+aon)/simulations,
  averageTotalXg:(hxg+axg)/simulations,meanAbsoluteGoalDifference:diff/simulations,
  goallessRate:goalless/simulations,anyTeamFivePlusGoalsRate:anyFivePlus/simulations,
  sixPlusTotalGoalsRate:sixPlusTotal/simulations,homeWinByThreePlusRate:homeByThree/simulations,
  awayWinByThreePlusRate:awayByThree/simulations,maxTeamGoals,maxTotalGoals};
}
export function runMatchBalanceAnalysis(db:SqliteDatabase,clubA:number,clubB:number,simulations=5000,seed=73421):MonteCarloReport{
 if(clubA===clubB)throw new Error("Balance analysis requires two different clubs.");
 const fixture=db.prepare("SELECT id FROM fixture WHERE status=? AND ((home_club_id=? AND away_club_id=?) OR (home_club_id=? AND away_club_id=?)) ORDER BY id LIMIT 1").get("SCHEDULED",clubA,clubB,clubB,clubA) as {id:number}|undefined;
 const fixtureId=fixture?.id??-1;
 if(fixtureId<0){return runMonteCarlo(loadTeam(db,-1,clubA,false),loadTeam(db,-1,clubB,false),simulations,seed);}
 return runMonteCarlo(loadTeam(db,fixtureId,clubA,false),loadTeam(db,fixtureId,clubB,false),simulations,seed);
}

export interface TacticalImpactScenario {name:string;description:string;result:MonteCarloReport;homeWinRateDelta:number;averageHomeGoalsDelta:number;homeShotsDelta:number;averageTotalXgDelta:number;}
export interface TacticalImpactReport {homeClubId:number;awayClubId:number;simulations:number;seed:number;scenarios:TacticalImpactScenario[];}
export function runTacticalImpactAnalysis(db:SqliteDatabase,homeClubId:number,awayClubId:number,simulations=5000,seed=73421):TacticalImpactReport {
 if(homeClubId===awayClubId)throw new Error("Tactical impact analysis requires two different clubs.");
 if(!Number.isSafeInteger(simulations)||simulations<100)throw new Error("Tactical impact simulations must be an integer >= 100.");
 const home=loadTeam(db,-1,homeClubId,false),away=loadTeam(db,-1,awayClubId,false);
 const cases=[
  {name:"baseline",description:"Táticas atuais dos dois clubes.",homePatch:{},awayPatch:{}},
  {name:"home_attacking",description:"Mandante com mentalidade muito ofensiva, pressão e ritmo altos.",homePatch:{mentality:"VERY_ATTACKING",pressing:85,tempo:80,defensive_line:65},awayPatch:{}},
  {name:"home_defensive",description:"Mandante defensivo, com pressão e ritmo baixos.",homePatch:{mentality:"DEFENSIVE",pressing:35,tempo:35,defensive_line:35},awayPatch:{}},
  {name:"away_high_press",description:"Visitante muito ofensivo, com pressão alta.",homePatch:{},awayPatch:{mentality:"VERY_ATTACKING",pressing:90,tempo:80,defensive_line:65}},
 ] as const;
 const base=runMonteCarlo(home,away,simulations,seed);
 const scenarios:TacticalImpactScenario[]=cases.map(c=>{
  const h:Team={...home,tactic:{...home.tactic,...c.homePatch}};
  const a:Team={...away,tactic:{...away.tactic,...c.awayPatch}};
  const result=c.name==="baseline"?base:runMonteCarlo(h,a,simulations,seed);
  return {name:c.name,description:c.description,result,homeWinRateDelta:result.homeWinRate-base.homeWinRate,
   averageHomeGoalsDelta:result.averageHomeGoals-base.averageHomeGoals,
   homeShotsDelta:result.homeShotRate-base.homeShotRate,
   averageTotalXgDelta:result.averageTotalXg-base.averageTotalXg};
 });
 return {homeClubId,awayClubId,simulations,seed,scenarios};
}

export interface XgBandDiagnostic {
 band:string;shots:number;averageXg:number;onTargetRate:number;goalRate:number;saveRate:number;missRate:number;goals:number;saves:number;misses:number;
}
export interface MatchEngineDiagnostics {
 simulations:number;
 baseline:MonteCarloReport;
 xgBands:XgBandDiagnostic[];
 homeAdvantage:{clubA:number;clubB:number;clubAWinRateAtHome:number;clubAWinRateAway:number;homeAdvantageDelta:number;shotChanceBonus:number;note:string};
 strengthGap:{weakClubId:number;strongClubId:number;weakStrength:number;strongStrength:number;strengthDifference:number;hasMeaningfulGap:boolean;note:string;strongWinRate:number;drawRate:number;weakWinRate:number;strongAverageGoals:number;weakAverageGoals:number};
 persistedMatches:{checked:number;issues:string[];warnings:string[]};
}
export function runEngineDiagnostics(db:SqliteDatabase,simulations=2000,seed=88421):MatchEngineDiagnostics {
 if(!Number.isSafeInteger(simulations)||simulations<100)throw new Error("Diagnostics simulations must be an integer >= 100.");
 const ids=(db.prepare("SELECT id FROM club ORDER BY id").all() as Array<{id:number}>).map(r=>r.id);
 if(ids.length<2)throw new Error("Diagnostics require at least two clubs.");
 const teams=ids.map(id=>loadTeam(db,-1,id,false));
 const strength=(t:Team)=>t.attacking*.4+t.defending*.35+t.goalkeeping*.25;
 const ranked=teams.map(team=>({team,value:strength(team)})).sort((a,b)=>a.value-b.value||a.team.clubId-b.team.clubId);
 const weak=ranked[0]!,strong=ranked[ranked.length-1]!;
 const baseline=runMonteCarlo(strong.team,weak.team,simulations,seed);
 const bands=[
  {label:"0.00-0.05",min:0,max:.05,shots:0,xg:0,onTarget:0,goals:0,saves:0,misses:0},
  {label:"0.05-0.10",min:.05,max:.10,shots:0,xg:0,onTarget:0,goals:0,saves:0,misses:0},
  {label:"0.10-0.15",min:.10,max:.15,shots:0,xg:0,onTarget:0,goals:0,saves:0,misses:0},
  {label:"0.15-0.20",min:.15,max:.20,shots:0,xg:0,onTarget:0,goals:0,saves:0,misses:0},
  {label:"0.20+",min:.20,max:Infinity,shots:0,xg:0,onTarget:0,goals:0,saves:0,misses:0},
 ];
 for(let i=0;i<simulations;i++){
  const timeline=simulateMatchTimeline(strong.team,weak.team,seed+i*7919);
  for(const e of timeline.events){
   const b=bands.find(item=>e.xg>=item.min&&e.xg<item.max)!;
   b.shots++;b.xg+=e.xg;
   if(e.eventType==="GOAL"){b.goals++;b.onTarget++;}
   else if(e.eventType==="SAVE"){b.saves++;b.onTarget++;}
   else b.misses++;
  }
 }
 
 const xgBands: XgBandDiagnostic[]=bands.map(b=>({band:b.label,shots:b.shots,averageXg:b.shots?b.xg/b.shots:0,onTargetRate:b.shots?(b.onTarget/b.shots):0,goalRate:b.shots?b.goals/b.shots:0,saveRate:b.shots?b.saves/b.shots:0,missRate:b.shots?b.misses/b.shots:0,goals:b.goals,saves:b.saves,misses:b.misses}));
 const ab=runMonteCarlo(strong.team,weak.team,simulations,seed+1700003);
 const ba=runMonteCarlo(weak.team,strong.team,simulations,seed+1700003);
 const persistedRows=db.prepare("SELECT f.id,f.home_club_id,f.away_club_id,f.home_score,f.away_score,f.current_minute, s.simulation_minute,s.state_json,(SELECT COUNT(*) FROM match_momentum m WHERE m.fixture_id=f.id) AS momentum_count,(SELECT COUNT(*) FROM match_event e WHERE e.fixture_id=f.id AND e.event_type='GOAL' AND e.club_id=f.home_club_id) AS event_home_goals,(SELECT COUNT(*) FROM match_event e WHERE e.fixture_id=f.id AND e.event_type='GOAL' AND e.club_id=f.away_club_id) AS event_away_goals FROM fixture f LEFT JOIN match_simulation_state s ON s.fixture_id=f.id WHERE f.status='COMPLETED' ORDER BY f.id DESC LIMIT 100").all() as Array<{id:number;home_score:number;away_score:number;current_minute:number;simulation_minute:number|null;state_json:string|null;momentum_count:number;event_home_goals:number;event_away_goals:number}>;
 const issues:string[]=[];
 const warnings:string[]=[];
 for(const r of persistedRows){
  if(r.current_minute!==90)issues.push(`Fixture ${r.id}: completed with current_minute=${r.current_minute}`);
  if(r.event_home_goals!==r.home_score||r.event_away_goals!==r.away_score)issues.push(`Fixture ${r.id}: score differs from GOAL events`);
  if(r.momentum_count!==90)issues.push(`Fixture ${r.id}: expected 90 momentum rows, found ${r.momentum_count}`);
  if(r.simulation_minute===null){
   warnings.push(`Fixture ${r.id}: no simulation checkpoint; this may be a legacy match completed before checkpoint persistence was introduced`);
  }else{
   let checkpointCompleted=false;
   try { checkpointCompleted=!!r.state_json&&JSON.parse(r.state_json).completed===true; } catch { checkpointCompleted=false; }
   if(r.simulation_minute!==90||!checkpointCompleted)issues.push(`Fixture ${r.id}: final checkpoint exists but is malformed or incomplete`);
  }
 }
 return {
  simulations,baseline,xgBands,
  homeAdvantage:{clubA:strong.team.clubId,clubB:weak.team.clubId,clubAWinRateAtHome:ab.homeWinRate,clubAWinRateAway:ba.awayWinRate,homeAdvantageDelta:ab.homeWinRate-ba.awayWinRate,shotChanceBonus:HOME_SHOT_CHANCE_BONUS,note:"Explicit home advantage: +0.004 absolute shot-creation probability per minute for the home side. The win-rate delta is a seeded Monte Carlo estimate, not a guarantee."},
  strengthGap:{weakClubId:weak.team.clubId,strongClubId:strong.team.clubId,weakStrength:weak.value,strongStrength:strong.value,strengthDifference:strong.value-weak.value,hasMeaningfulGap:strong.value-weak.value>=8,note:strong.value-weak.value>=8?"Club ratings provide a useful strength contrast.":"Available clubs are too similar for a meaningful favorite-versus-underdog test; use a save with a larger ratings spread.",strongWinRate:baseline.homeWinRate,drawRate:baseline.drawRate,weakWinRate:baseline.awayWinRate,strongAverageGoals:baseline.averageHomeGoals,weakAverageGoals:baseline.averageAwayGoals},
  persistedMatches:{checked:persistedRows.length,issues,warnings}
 };
}


export function simulateMatch(db:SqliteDatabase,fixtureId:number):MatchSummary {
 const f=db.prepare("SELECT id,home_club_id,away_club_id,random_seed,status FROM fixture WHERE id=?").get(fixtureId) as FixtureRow|undefined;
 if(!f)throw new Error(`Fixture ${fixtureId} not found.`);
 if(f.status==="COMPLETED")throw new Error(`Fixture ${fixtureId} is already completed.`);
 if(f.status==="CANCELLED"||f.status==="POSTPONED")throw new Error(`Fixture ${fixtureId} is not playable (status: ${f.status}).`);
 if(f.status!=="SCHEDULED"&&f.status!=="IN_PROGRESS")throw new Error(`Fixture ${fixtureId} cannot be played from status ${f.status}.`);
 const seed=f.random_seed??(f.id*2654435761>>>0);
 const home=loadTeam(db,fixtureId,f.home_club_id),away=loadTeam(db,fixtureId,f.away_club_id);
 const timeline=simulateMatchTimeline(home,away,seed);
 const existing=db.prepare("SELECT simulation_minute,state_json FROM match_simulation_state WHERE fixture_id=?")
  .get(fixtureId) as {simulation_minute:number;state_json:string}|undefined;
 let startMinute=existing?.simulation_minute??0;
 if(existing){
  let checkpoint:{seed?:number;completed?:boolean};
  try{checkpoint=JSON.parse(existing.state_json) as {seed?:number;completed?:boolean};}
  catch{throw new Error(`Fixture ${fixtureId} has an invalid simulation checkpoint; refusing to overwrite it.`);}
  if(checkpoint.seed!==seed)throw new Error(`Fixture ${fixtureId} checkpoint seed does not match its fixture seed.`);
  if(startMinute<0||startMinute>90)throw new Error(`Fixture ${fixtureId} checkpoint minute is invalid.`);
 }else if(f.status==="IN_PROGRESS"){
  throw new Error(`Fixture ${fixtureId} is IN_PROGRESS but has no checkpoint; manual repair is required.`);
 }
 if(!existing){
  const begin=db.transaction(()=>{
   db.prepare("DELETE FROM match_event WHERE fixture_id=?").run(fixtureId);
   db.prepare("DELETE FROM match_momentum WHERE fixture_id=?").run(fixtureId);
   db.prepare("DELETE FROM match_player_state WHERE fixture_id=?").run(fixtureId);
   db.prepare("INSERT INTO match_event(fixture_id,minute,event_type,xg,description) VALUES(?,0,'KICK_OFF',0,'Partida iniciada')").run(fixtureId);
   db.prepare("INSERT INTO match_simulation_state(fixture_id,state_version,simulation_minute,state_json) VALUES(?,1,0,?)")
    .run(fixtureId,JSON.stringify({seed,minute:0,homeScore:0,awayScore:0,completed:false}));
   db.prepare("UPDATE fixture SET status='IN_PROGRESS',current_minute=0,home_score=0,away_score=0 WHERE id=?").run(fixtureId);
  });
  begin.immediate();
 }
 const insertEvent=db.prepare("INSERT INTO match_event(fixture_id,minute,club_id,player_id,secondary_player_id,event_type,xg,description) VALUES(?,?,?,?,?,?,?,?)");
 const insertMomentum=db.prepare("INSERT INTO match_momentum(fixture_id,minute,home_pressure,away_pressure,home_score,away_score) VALUES(?,?,?,?,?,?)");
 const checkpoint=db.prepare("UPDATE match_simulation_state SET simulation_minute=?,state_json=?,updated_at=CURRENT_TIMESTAMP WHERE fixture_id=?");
 const minuteUpdate=db.transaction((m:KernelMinute)=>{
  for(const e of m.events)insertEvent.run(fixtureId,e.minute,e.clubId,e.playerId,e.secondaryPlayerId,e.eventType,e.xg,e.description);
  insertMomentum.run(fixtureId,m.minute,m.homePressure,m.awayPressure,m.homeScore,m.awayScore);
  checkpoint.run(m.minute,JSON.stringify({seed,minute:m.minute,homeScore:m.homeScore,awayScore:m.awayScore,
   homeShots:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.home_club_id).length,
   awayShots:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.away_club_id).length,
   homeShotsOnTarget:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.home_club_id&&(e.eventType==="GOAL"||e.eventType==="SAVE")).length,
   awayShotsOnTarget:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.away_club_id&&(e.eventType==="GOAL"||e.eventType==="SAVE")).length,
   homePressure:m.homePressure,awayPressure:m.awayPressure,
   homeXg:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.home_club_id).reduce((n,e)=>n+e.xg,0),
   awayXg:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.away_club_id).reduce((n,e)=>n+e.xg,0),
   completed:false}),fixtureId);
  db.prepare("UPDATE fixture SET status='IN_PROGRESS',current_minute=?,home_score=?,away_score=? WHERE id=?")
   .run(m.minute,m.homeScore,m.awayScore,fixtureId);
 });
 for(const m of timeline.minutes)if(m.minute>startMinute)minuteUpdate.immediate(m);
 const finalise=db.transaction(()=>{
  const alreadyFullTime=db.prepare("SELECT 1 FROM match_event WHERE fixture_id=? AND event_type='FULL_TIME'").get(fixtureId);
  if(!alreadyFullTime)insertEvent.run(fixtureId,90,null,null,null,"FULL_TIME",0,"Fim de jogo");
  db.prepare("DELETE FROM match_player_state WHERE fixture_id=?").run(fixtureId);
  const state=db.prepare("INSERT INTO match_player_state(fixture_id,player_id,club_id,energy,rating,minutes_played) VALUES(?,?,?,?,?,?)");
  for(const team of [home,away])for(const p of team.lineup){
   const loss=p.isStarting?14:2;
   state.run(fixtureId,p.id,team.clubId,Math.max(0,p.energy-loss),p.isStarting?6.3:6,p.isStarting?90:0);
   db.prepare("UPDATE player_condition SET energy=MAX(0,energy-?) WHERE player_id=?").run(loss,p.id);
   if(p.isStarting){
    const delta=timeline.result.homeScore===timeline.result.awayScore?0:
     (team.clubId===f.home_club_id?(timeline.result.homeScore>timeline.result.awayScore?2:-2):
      (timeline.result.awayScore>timeline.result.homeScore?2:-2));
    db.prepare("UPDATE player_condition SET morale=MIN(100,MAX(0,morale+?)) WHERE player_id=?").run(delta,p.id);
   }
  }
  db.prepare("UPDATE fixture SET status='COMPLETED',current_minute=90,home_score=?,away_score=? WHERE id=?")
   .run(timeline.result.homeScore,timeline.result.awayScore,fixtureId);
  checkpoint.run(90,JSON.stringify({seed,minute:90,homeScore:timeline.result.homeScore,
   awayScore:timeline.result.awayScore,homeShots:timeline.result.homeShots,awayShots:timeline.result.awayShots,
   homeXg:timeline.result.homeXg,awayXg:timeline.result.awayXg,completed:true}),fixtureId);
 });
 finalise.immediate();
 const actual=db.prepare("SELECT club_id AS club,event_type AS type,COALESCE(SUM(xg),0) AS xg,COUNT(*) AS count FROM match_event WHERE fixture_id=? AND club_id IS NOT NULL AND event_type IN ('GOAL','SAVE','MISS') GROUP BY club_id,event_type").all(fixtureId) as Array<{club:number;type:string;xg:number;count:number}>;
 const metric=(club:number,types:string[])=>actual.filter(e=>e.club===club&&types.includes(e.type)).reduce((n,e)=>n+e.count,0);
 const xg=(club:number)=>actual.filter(e=>e.club===club).reduce((n,e)=>n+e.xg,0);
 const count=(db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=?").get(fixtureId) as {count:number}).count;
 return {fixtureId,homeClubId:f.home_club_id,awayClubId:f.away_club_id,
  homeScore:metric(f.home_club_id,["GOAL"]),awayScore:metric(f.away_club_id,["GOAL"]),
  homeShots:metric(f.home_club_id,["GOAL","SAVE","MISS"]),awayShots:metric(f.away_club_id,["GOAL","SAVE","MISS"]),
  homeShotsOnTarget:metric(f.home_club_id,["GOAL","SAVE"]),awayShotsOnTarget:metric(f.away_club_id,["GOAL","SAVE"]),
  homeXg:xg(f.home_club_id),awayXg:xg(f.away_club_id),events:count,minutes:90};
}
