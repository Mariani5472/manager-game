import { performance } from "node:perf_hooks";
import type { SqliteDatabase } from "../db/database.js";
import { persistMatchEnvironment, recoverSquadBeforeMatch, resolveMatchContext, type MatchContext } from "./matchContext.js";
export interface MatchSummary {fixtureId:number;homeClubId:number;awayClubId:number;homeScore:number;awayScore:number;events:number;minutes:number;homeShots:number;awayShots:number;homeShotsOnTarget:number;awayShotsOnTarget:number;homeXg:number;awayXg:number;}
interface FixtureRow{id:number;home_club_id:number;away_club_id:number;random_seed:number|null;status:string;}
export interface Player{id:number;name:string;goalkeeper:number;energy:number;morale:number;sharpness:number;pace:number;stamina:number;strength:number;positioning:number;decisions:number;composure:number;teamwork:number;work_rate:number;passing:number;vision:number;crossing:number;dribbling:number;finishing:number;long_shots:number;heading:number;tackling:number;marking:number;aggression:number;concentration:number;reflexes:number;handling:number;aerial_reach:number;}
export interface Tactic{formation_id:number;mentality:string;pressing:number;tempo:number;defensive_line:number;width:number;passing_directness:number;counter_attack:number;}
export interface MatchPlayer extends Player{role:string;slot:number;isStarting:boolean;positionRating:number;}
export interface Team{clubId:number;reputation:number;tactic:Tactic;lineup:MatchPlayer[];attacking:number;defending:number;goalkeeping:number;energy:number;fitness:number;context?:MatchContext;}
export interface SimulatedMatchResult{homeScore:number;awayScore:number;homeShots:number;awayShots:number;homeShotsOnTarget:number;awayShotsOnTarget:number;homeXg:number;awayXg:number;}
export interface MonteCarloReport{simulations:number;homeWinRate:number;drawRate:number;awayWinRate:number;averageHomeGoals:number;averageAwayGoals:number;averageTotalGoals:number;homeShotRate:number;awayShotRate:number;averageTotalShots:number;averageTotalShotsOnTarget:number;averageTotalXg:number;meanAbsoluteGoalDifference:number;goallessRate:number;anyTeamFivePlusGoalsRate:number;sixPlusTotalGoalsRate:number;homeWinByThreePlusRate:number;awayWinByThreePlusRate:number;maxTeamGoals:number;maxTotalGoals:number;}
function rng(seed:number):()=>number{let s=seed>>>0;return()=>{s+=0x6D2B79F5;let v=s;v=Math.imul(v^(v>>>15),v|1);v^=v+Math.imul(v^(v>>>7),v|61);return((v^(v>>>14))>>>0)/4294967296;};}
function clamp(n:number,a:number,b:number):number{return Math.max(a,Math.min(b,n));}
function mean(xs:number[]):number{return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:50;}
const compatible:Record<string,string[]>={GK:["GK"],CB:["CB"],LB:["LB","LWB","RB"],RB:["RB","RWB","LB"],LWB:["LWB","LB","RWB"],RWB:["RWB","RB","LWB"],DM:["DM","CM"],CM:["CM","DM","AM"],AM:["AM","CM","ST"],LW:["LW","LM","RW","RM"],RW:["RW","RM","LW","LM"],LM:["LM","LW","RM","RW"],RM:["RM","RW","LM","LW"],ST:["ST","AM"]};
function fit(actual:string,required:string):number{return actual===required?1:(compatible[required]?.includes(actual)?0.82:0.48);}
function tactic(db:SqliteDatabase,clubId:number):Tactic{const t=db.prepare("SELECT formation_id,mentality,pressing,tempo,defensive_line,width,passing_directness,counter_attack FROM team_tactic WHERE club_id=?").get(clubId) as Tactic|undefined;if(!t)throw new Error(`Tactics for club ${clubId} were not found.`);return t;}
function loadPlayers(db:SqliteDatabase,clubId:number,fixtureId:number):Player[]{const date=db.prepare("SELECT substr(scheduled_at,1,10) AS date FROM fixture WHERE id=?").get(fixtureId) as {date:string|null}|undefined;return db.prepare(`SELECT p.person_id AS id,pe.full_name AS name,p.goalkeeper,COALESCE(pc.energy,100) energy,COALESCE(pc.morale,50) morale,COALESCE(pc.sharpness,50) sharpness,pa.pace,pa.stamina,pa.strength,pa.positioning,pa.decisions,pa.composure,pa.teamwork,pa.work_rate,pa.passing,pa.vision,pa.crossing,pa.dribbling,pa.finishing,pa.long_shots,pa.heading,pa.tackling,pa.marking,pa.aggression,pa.concentration,pa.reflexes,pa.handling,pa.aerial_reach FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id JOIN person pe ON pe.id=p.person_id JOIN player_attribute pa ON pa.player_id=p.person_id LEFT JOIN player_condition pc ON pc.player_id=p.person_id WHERE sm.club_id=? AND COALESCE(pc.suspension_matches,0)=0 AND (pc.injured_until IS NULL OR ? IS NULL OR date(pc.injured_until)<date(?)) ORDER BY p.person_id`).all(clubId,date?.date??null,date?.date??null) as Player[];}
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
function loadTeam(db:SqliteDatabase,fixtureId:number,clubId:number,persistLineup=true):Team{const c=db.prepare("SELECT reputation FROM club WHERE id=?").get(clubId) as {reputation:number}|undefined;if(!c)throw new Error(`Club ${clubId} not found.`);const t=tactic(db,clubId),players=loadPlayers(db,clubId,fixtureId),lineup=selectLineup(db,fixtureId,clubId,players,t,persistLineup),s=lineup.filter(p=>p.isStarting);const posRating=mean(s.map(p=>p.positionRating*fit(bestPosition(p.id,loadPositions(db,clubId)),p.role)));const attacking=mean(s.map(p=>skill(p,p.role)*.72+p.positionRating*.28+p.energy*.18+p.morale*.08+p.sharpness*.08));const defending=mean(s.map(p=>mean([p.tackling,p.marking,p.positioning,p.concentration,p.strength])));const keeper=s.find(p=>p.isStarting&&p.role==="GK");return{clubId,reputation:c.reputation,tactic:t,lineup,attacking:attacking+(posRating-50)*.15,defending,goalkeeping:keeper?mean([keeper.reflexes,keeper.handling,keeper.aerial_reach,keeper.positioning]):45,energy:mean(s.map(p=>p.energy)),fitness:mean(s.map(p=>p.stamina)),context:resolveMatchContext(db,fixtureId,clubId)};}
interface KernelShotEvent {
 minute:number; clubId:number; playerId:number; secondaryPlayerId:number|null;
 eventType:"GOAL"|"SAVE"|"MISS"|"SUBSTITUTION"|"TACTIC_CHANGE"|"CHANCE"|"FOUL"|"YELLOW_CARD"|"RED_CARD"|"INJURY"; xg:number; description:string; injuryDays?:number;
}
interface KernelMinute { minute:number; homePressure:number; awayPressure:number; homeScore:number; awayScore:number; events:KernelShotEvent[]; }
interface TacticalChange {id:number;minute:number;club_id:number;change_type:string;payload:string;}
interface KernelTimeline {result:SimulatedMatchResult; events:KernelShotEvent[]; minutes:KernelMinute[];}
const HOME_SHOT_CHANCE_BONUS=0.004; // +0.4 percentage points per minute: modest, isolated home advantage.
export const MATCH_EVENT_PROBABILITIES = {
 foulPerTeamMinute:0.12,
 yellowCardPerTeamMinute:0.022,
 redCardPerTeamMinute:0.0005,
 injuryPerTeamMinute:0.0015,
 defensiveErrorPerDefendingTeamMinute:0.0015,
 substitutionAttemptPerTeamMinuteAfter60:0.035,
} as const;
function mentalityShotModifier(value:string):number {
 return ({"VERY_DEFENSIVE":-.018,"DEFENSIVE":-.009,"BALANCED":0,"ATTACKING":.009,"VERY_ATTACKING":.018}[value]??0);
}
function teamPressure(team:Team, random:()=>number):number {
 const mentality={"VERY_DEFENSIVE":-5,"DEFENSIVE":-2,"BALANCED":0,"ATTACKING":3,"VERY_ATTACKING":5}[team.tactic.mentality]??0;
 const ctx=team.context??{weather:"CLEAR",temperatureC:20,pitchCondition:70,restHours:168,travelKm:0,travelHours:0};
 const fatigue=Math.min(5,Math.max(0,72-ctx.restHours)/24*1.4+ctx.travelKm/500*1.1);
 return clamp(team.attacking*.43+team.tactic.pressing*.16+team.tactic.tempo*.10+
  team.tactic.defensive_line*.04+mentality-fatigue+random()*8,0,100);
}
function shotCreationProbability(
 team:Team,opponent:Team,isHome:boolean,pressure:number,opponentPressure:number,
):number {
 const tactic=team.tactic;
 const ctx=team.context??{weather:"CLEAR",temperatureC:20,pitchCondition:70,restHours:168,travelKm:0,travelHours:0};
 const fatigue=Math.min(.035,Math.max(0,72-ctx.restHours)*.00020+ctx.travelKm/500*.004);
 const weatherPenalty=ctx.weather==="HEAVY_RAIN"?.012:ctx.weather==="RAIN"?.006:ctx.weather==="WIND"?(tactic.passing_directness<60?.008:.003):ctx.weather==="HEAT"?.004:0;
 const pitchPenalty=Math.max(0,70-ctx.pitchCondition)*.00012;
 return clamp(.095+(team.attacking-50)*.00135+(50-opponent.defending)*.00060+
  mentalityShotModifier(tactic.mentality)+(tactic.pressing-50)*.00012+
  (tactic.tempo-50)*.00012+(pressure-opponentPressure)*.00012+
  (tactic.passing_directness-50)*.000055+(tactic.width-50)*.000025+
  (tactic.counter_attack?.004:0)+(isHome?HOME_SHOT_CHANCE_BONUS:0)-fatigue-weatherPenalty-pitchPenalty,.05,.205);
}
function sampleChanceQuality(team:Team,tactic:Tactic,finishing:number,random:()=>number):number {
 const ctx=team.context??{weather:"CLEAR",temperatureC:20,pitchCondition:70,restHours:168,travelKm:0,travelHours:0};
 const qualityRoll=random();
 const baseXg=qualityRoll<.56 ? .035+random()*.06 :
  qualityRoll<.92 ? .095+random()*.075 : .17+random()*.15;
 return clamp(baseXg+(team.attacking-50)*.00042+(finishing-50)*.00018+
  (tactic.tempo-50)*.00004+(tactic.passing_directness-50)*.00006+
  (tactic.width-50)*.000035-
  Math.max(0,70-ctx.pitchCondition)*.00025-
  (ctx.weather==="HEAVY_RAIN"?.012:ctx.weather==="RAIN"?.006:ctx.weather==="WIND"?.004:0),.02,.38);
}
function onTargetProbability(xg:number):number { return clamp(.29+xg*.5,.30,.48); }
function goalConversionProbability(xg:number,onTargetChance:number,keeperSkill:number):number {
 const keeperFactor=clamp(1+(50-keeperSkill)*.0075,.66,1.34);
 return clamp((xg/onTargetChance)*keeperFactor,.015,.82);
}
function refreshTeamStrength(team:Team):void{const starters=team.lineup.filter(p=>p.isStarting);team.attacking=mean(starters.map(p=>skill(p,p.role)*.72+p.positionRating*.28+p.energy*.18+p.morale*.08+p.sharpness*.08))+(mean(starters.map(p=>p.positionRating))-50)*.15;team.defending=mean(starters.map(p=>mean([p.tackling,p.marking,p.positioning,p.concentration,p.strength])));const keeper=starters.find(p=>p.role==="GK");team.goalkeeping=keeper?mean([keeper.reflexes,keeper.handling,keeper.aerial_reach,keeper.positioning]):45;team.energy=mean(starters.map(p=>p.energy));team.fitness=mean(starters.map(p=>p.stamina));}
function simulateMatchTimeline(home:Team,away:Team,seed:number,changes:TacticalChange[]=[]):KernelTimeline {
 home={...home,tactic:{...home.tactic},lineup:home.lineup.map(p=>({...p}))};
 away={...away,tactic:{...away.tactic},lineup:away.lineup.map(p=>({...p}))};
 // Random streams are tied to club identity, not home/away slot. This makes side-swapped
 // diagnostics a paired comparison rather than a comparison polluted by RNG draw order.
 const homeRandom=rng(seed ^ Math.imul(home.clubId,0x9e3779b1));
 const awayRandom=rng(seed ^ Math.imul(away.clubId,0x9e3779b1));
 const homeEventRandom=rng((seed ^ Math.imul(home.clubId,0x85ebca6b) ^ 0x51ed270b)>>>0);
 const awayEventRandom=rng((seed ^ Math.imul(away.clubId,0x85ebca6b) ^ 0x51ed270b)>>>0);
 const homeErrorRandom=rng((seed ^ Math.imul(home.clubId,0xc2b2ae35) ^ 0x27d4eb2f)>>>0);
 const awayErrorRandom=rng((seed ^ Math.imul(away.clubId,0xc2b2ae35) ^ 0x27d4eb2f)>>>0);
 let hs=0,as=0,hShots=0,aShots=0,hOn=0,aOn=0,hxg=0,axg=0;
 const events:KernelShotEvent[]=[];
 const minutes:KernelMinute[]=[];
 for(let minute=1;minute<=90;minute++){
  const minuteEvents:KernelShotEvent[]=[];
  for(const change of changes.filter(item=>item.minute===minute)){
   const priorEventCount=minuteEvents.length;
   const team=change.club_id===home.clubId?home:change.club_id===away.clubId?away:null;
   if(!team)throw new Error(`Tactical change ${change.id} targets a club outside the fixture.`);
   let payload:Record<string,unknown>;
   try{payload=JSON.parse(change.payload) as Record<string,unknown>;}catch{throw new Error(`Tactical change ${change.id} has invalid JSON.`);}
   if(change.change_type==="SUBSTITUTION"){
    const outId=Number(payload.playerOutId),inId=Number(payload.playerInId);
    const outgoing=team.lineup.find(p=>p.id===outId&&p.isStarting),incoming=team.lineup.find(p=>p.id===inId&&!p.isStarting);
    if(!outgoing||!incoming)throw new Error(`Substitution ${change.id} needs an active player and a bench player.`);
    if(outgoing.role==="GK"&&incoming.goalkeeper!==1)throw new Error("A goalkeeper can only be replaced by another goalkeeper.");
    incoming.role=outgoing.role;incoming.slot=outgoing.slot;incoming.isStarting=true;outgoing.isStarting=false;refreshTeamStrength(team);
    minuteEvents.push({minute,clubId:team.clubId,playerId:outgoing.id,secondaryPlayerId:incoming.id,eventType:"SUBSTITUTION",xg:0,description:`Substituição: ${outgoing.name} sai, ${incoming.name} entra`});
   }else if(change.change_type==="MENTALITY"){
    const mentality=String(payload.mentality??"");
    if(!["VERY_DEFENSIVE","DEFENSIVE","BALANCED","ATTACKING","VERY_ATTACKING"].includes(mentality))throw new Error(`Tactical change ${change.id} has invalid mentality.`);
    team.tactic={...team.tactic,mentality};
    minuteEvents.push({minute,clubId:team.clubId,playerId:0,secondaryPlayerId:null,eventType:"TACTIC_CHANGE",xg:0,description:`Mentalidade alterada para ${mentality}`});
   }else if(change.change_type==="INSTRUCTION"){
    const key=String(payload.key??""),value=Number(payload.value);
    const ranges:Record<string,[number,number]>={pressing:[0,100],tempo:[0,100],defensive_line:[0,100],width:[0,100],passing_directness:[0,100],counter_attack:[0,1]};
    if(!ranges[key]||!Number.isFinite(value)||value<ranges[key]![0]||value>ranges[key]![1])throw new Error(`Tactical change ${change.id} has invalid instruction.`);
    team.tactic={...team.tactic,[key]:value};
    minuteEvents.push({minute,clubId:team.clubId,playerId:0,secondaryPlayerId:null,eventType:"TACTIC_CHANGE",xg:0,description:`Instrução alterada: ${key} = ${value}`});
   }else if(change.change_type==="FORMATION"){
    const slots=payload.slots;
    if(!Array.isArray(slots)||slots.length!==11)throw new Error(`Formation change ${change.id} requires eleven assignments.`);
    const assigned=new Set<number>();
    for(const player of team.lineup.filter(p=>p.isStarting))player.isStarting=false;
    for(const raw of slots as Array<Record<string,unknown>>){
     const playerId=Number(raw.playerId),slot=Number(raw.slotNumber),role=String(raw.positionCode??"");
     const player=team.lineup.find(p=>p.id===playerId);
     if(!player||assigned.has(playerId)||!Number.isInteger(slot)||!["GK","CB","LB","RB","LWB","RWB","DM","CM","AM","LW","RW","LM","RM","ST"].includes(role))throw new Error(`Formation change ${change.id} has invalid slot assignments.`);
     player.isStarting=true;player.slot=slot;player.role=role;assigned.add(playerId);
    }
    if(team.lineup.filter(p=>p.isStarting).length!==11||team.lineup.filter(p=>p.isStarting&&p.role==="GK"&&p.goalkeeper===1).length!==1)throw new Error("Formation change must retain eleven players and one goalkeeper.");
    team.tactic={...team.tactic,formation_id:Number(payload.formationId)};refreshTeamStrength(team);
    minuteEvents.push({minute,clubId:team.clubId,playerId:0,secondaryPlayerId:null,eventType:"TACTIC_CHANGE",xg:0,description:"Formação alterada durante a partida"});
   }
   if(minuteEvents.length>priorEventCount)events.push(minuteEvents[minuteEvents.length-1]!);
  }
  // Independent event streams keep cards/injuries/errors reproducible without
  // perturbing the shot RNG stream when event rates are adjusted.
  for(const incident of [
    {team:home,random:homeEventRandom},
    {team:away,random:awayEventRandom},
  ]) {
   const chooseActive=()=>{
    const active=incident.team.lineup.filter(player=>player.isStarting&&player.role!=="GK");
    return active.length?active[Math.floor(incident.random()*active.length)]:undefined;
   };
   if(!incident.team.lineup.some(player=>player.isStarting&&player.role!=="GK")) continue;
   if(incident.random()<MATCH_EVENT_PROBABILITIES.foulPerTeamMinute) {
    const player=chooseActive();
    if(player) {
     const event:KernelShotEvent={minute,clubId:incident.team.clubId,playerId:player.id,secondaryPlayerId:null,eventType:"FOUL",xg:0,description:`Falta cometida por ${player.name}`};
    minuteEvents.push(event);events.push(event);
    }
   }
   if(incident.random()<MATCH_EVENT_PROBABILITIES.yellowCardPerTeamMinute) {
    const player=chooseActive();
    if(player) {
     const secondYellow=events.some(event=>event.clubId===incident.team.clubId&&event.playerId===player.id&&event.eventType==="YELLOW_CARD");
     if(secondYellow) { player.isStarting=false;refreshTeamStrength(incident.team); }
     const event:KernelShotEvent={minute,clubId:incident.team.clubId,playerId:player.id,secondaryPlayerId:null,eventType:secondYellow?"RED_CARD":"YELLOW_CARD",xg:0,description:secondYellow?`Segundo amarelo e expulsão para ${player.name}`:`Cartão amarelo para ${player.name}`};
     minuteEvents.push(event);events.push(event);
    }
   }
   if(incident.random()<MATCH_EVENT_PROBABILITIES.redCardPerTeamMinute) {
    const player=chooseActive();
    if(player) {
     player.isStarting=false;refreshTeamStrength(incident.team);
     const event:KernelShotEvent={minute,clubId:incident.team.clubId,playerId:player.id,secondaryPlayerId:null,eventType:"RED_CARD",xg:0,description:`Cartão vermelho para ${player.name}`};
     minuteEvents.push(event);events.push(event);
    }
   }
   if(incident.random()<MATCH_EVENT_PROBABILITIES.injuryPerTeamMinute) {
    const currentlyActive=incident.team.lineup.filter(player=>player.isStarting&&player.role!=="GK");
    if(currentlyActive.length) {
     const injured=currentlyActive[Math.floor(incident.random()*currentlyActive.length)]!;
     const durationRoll=incident.random();
     const injuryDays=durationRoll<.70?7:durationRoll<.95?14:28;
     const event:KernelShotEvent={minute,clubId:incident.team.clubId,playerId:injured.id,secondaryPlayerId:null,eventType:"INJURY",xg:0,injuryDays,description:`Lesão de ${injured.name}; afastamento estimado de ${injuryDays} dias`};
     minuteEvents.push(event);events.push(event);
     const substitute=incident.team.lineup.find(player=>!player.isStarting&&player.role!=="GK");
     injured.isStarting=false;
     if(substitute) {
      substitute.role=injured.role;substitute.slot=injured.slot;substitute.isStarting=true;
      const subEvent:KernelShotEvent={minute,clubId:incident.team.clubId,playerId:injured.id,secondaryPlayerId:substitute.id,eventType:"SUBSTITUTION",xg:0,description:`Substituição por lesão: ${injured.name} sai, ${substitute.name} entra`};
      minuteEvents.push(subEvent);events.push(subEvent);
     }
     refreshTeamStrength(incident.team);
    }
   }
   const substitutionsUsed=events.filter(event=>event.clubId===incident.team.clubId&&event.eventType==="SUBSTITUTION").length;
   if(minute>=60&&substitutionsUsed<3&&incident.random()<MATCH_EVENT_PROBABILITIES.substitutionAttemptPerTeamMinuteAfter60) {
    const activeNow=incident.team.lineup.filter(player=>player.isStarting&&player.role!=="GK");
    const bench=incident.team.lineup.filter(player=>!player.isStarting&&player.role!=="GK");
    if(activeNow.length&&bench.length) {
     const outgoing=activeNow[Math.floor(incident.random()*activeNow.length)]!;
     const incoming=bench[Math.floor(incident.random()*bench.length)]!;
     outgoing.isStarting=false;incoming.isStarting=true;incoming.role=outgoing.role;incoming.slot=outgoing.slot;
     refreshTeamStrength(incident.team);
     const event:KernelShotEvent={minute,clubId:incident.team.clubId,playerId:outgoing.id,secondaryPlayerId:incoming.id,eventType:"SUBSTITUTION",xg:0,description:`Substituição tática: ${outgoing.name} sai, ${incoming.name} entra`};
     minuteEvents.push(event);events.push(event);
    }
   }
  }
  const hp=teamPressure(home,homeRandom),ap=teamPressure(away,awayRandom);
  for(const side of [
    {team:home,opponent:away,isHome:true,pressure:hp,opponentPressure:ap,random:homeRandom,opponentErrorRandom:awayErrorRandom},
    {team:away,opponent:home,isHome:false,pressure:ap,opponentPressure:hp,random:awayRandom,opponentErrorRandom:homeErrorRandom},
  ]){
   const tactic=side.team.tactic;
   const ctx=side.team.context??{weather:"CLEAR",temperatureC:20,pitchCondition:70,restHours:168,travelKm:0,travelHours:0};
   const defensiveError=side.opponentErrorRandom()<MATCH_EVENT_PROBABILITIES.defensiveErrorPerDefendingTeamMinute;
   const chance=shotCreationProbability(side.team,side.opponent,side.isHome,side.pressure,side.opponentPressure);
   if(!defensiveError&&side.random()>=chance)continue;
   if(defensiveError) {
    const errorEvent:KernelShotEvent={minute,clubId:side.team.clubId,playerId:0,secondaryPlayerId:null,eventType:"CHANCE",xg:0,description:`Erro defensivo do clube ${side.opponent.clubId} concede uma chance`};
    minuteEvents.push(errorEvent);events.push(errorEvent);
   }
   const attackers=side.team.lineup.filter(p=>p.isStarting&&p.role!=="GK");
   if(!attackers.length)throw new Error(`Club ${side.team.clubId} has no available outfield starters.`);
   const shooter=attackers[Math.floor(side.random()*attackers.length)]!;
   const keeper=side.opponent.lineup.find(p=>p.isStarting&&p.role==="GK");
   if(!keeper)throw new Error(`Club ${side.opponent.clubId} has no starting goalkeeper.`);
   const keeperSkill=mean([keeper.reflexes,keeper.handling,keeper.positioning,keeper.concentration]);
   // Sample shot quality from low-, medium-, and high-quality chance profiles.
   // The mixture retains a similar average xG while making clear chances observable in diagnostics.
   const sampledXg=sampleChanceQuality(side.team,tactic,shooter.finishing,side.random);
   const xg=defensiveError?clamp(sampledXg+.10,.02,.38):sampledXg;
   const onTargetChance=onTargetProbability(xg);
   const onTarget=side.random()<onTargetChance;
   const goal=onTarget&&side.random()<goalConversionProbability(xg,onTargetChance,keeperSkill);
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

export interface MeanConfidenceInterval {estimate:number;lower:number;upper:number;observations:number;confidenceLevel:number;}
export interface XgBandDiagnostic {
 band:string;shots:number;averageXg:number;averageXgInterval:MeanConfidenceInterval;
 onTargetRate:number;onTargetInterval:BinomialConfidenceInterval;
 goalRate:number;goalInterval:BinomialConfidenceInterval;
 saveRate:number;saveInterval:BinomialConfidenceInterval;
 missRate:number;missInterval:BinomialConfidenceInterval;
 goals:number;saves:number;misses:number;
}
export interface BinomialConfidenceInterval {
 estimate:number;
 lower:number;
 upper:number;
 successes:number;
 trials:number;
 confidenceLevel:number;
}
function meanConfidenceInterval(sum:number,sumSquares:number,observations:number,confidenceLevel=0.95):MeanConfidenceInterval {
 const estimate=observations?sum/observations:0;
 if(observations<2) return {estimate,lower:0,upper:.38,observations,confidenceLevel};
 const variance=Math.max(0,(sumSquares-sum*sum/observations)/(observations-1));
 const margin=1.959963984540054*Math.sqrt(variance/observations);
 return {estimate,lower:Math.max(0,estimate-margin),upper:Math.min(.38,estimate+margin),observations,confidenceLevel};
}
function wilsonInterval(rate:number,trials:number,confidenceLevel=0.95):BinomialConfidenceInterval {
 const successes=Math.round(clamp(rate,0,1)*trials);
 const z=confidenceLevel===0.95?1.959963984540054:confidenceLevel===0.99?2.5758293035489004:1.959963984540054;
 const p=successes/trials,z2=z*z,denominator=1+z2/trials;
 const center=(p+z2/(2*trials))/denominator;
 const margin=(z*Math.sqrt((p*(1-p)+z2/(4*trials))/trials))/denominator;
 return {estimate:p,lower:Math.max(0,center-margin),upper:Math.min(1,center+margin),successes,trials,confidenceLevel};
}
export interface MatchEngineDiagnostics {
 simulations:number;
 baseline:MonteCarloReport;
 statisticalAcceptance:{
  method:"Wilson score interval";
  confidenceLevel:number;
  outcomes:{homeWin:BinomialConfidenceInterval;draw:BinomialConfidenceInterval;awayWin:BinomialConfidenceInterval};
  outcomeRatesSum:number;
  outcomeRatesPartition:boolean;
  interpretation:string;
 };
 xgBands:XgBandDiagnostic[];
 homeAdvantage:{clubA:number;clubB:number;clubAWinRateAtHome:number;clubAWinRateAway:number;homeAdvantageDelta:number;shotChanceBonus:number;note:string};
 strengthGap:{weakClubId:number;strongClubId:number;weakStrength:number;strongStrength:number;strengthDifference:number;hasMeaningfulGap:boolean;note:string;strongWinRate:number;drawRate:number;weakWinRate:number;strongAverageGoals:number;weakAverageGoals:number};
 eventProbabilities:typeof MATCH_EVENT_PROBABILITIES;
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
  {label:"0.00-0.05",min:0,max:.05,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
  {label:"0.05-0.10",min:.05,max:.10,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
  {label:"0.10-0.15",min:.10,max:.15,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
  {label:"0.15-0.20",min:.15,max:.20,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
  {label:"0.20+",min:.20,max:Infinity,shots:0,xg:0,xgSquared:0,onTarget:0,goals:0,saves:0,misses:0},
 ];
 for(let i=0;i<simulations;i++){
  const timeline=simulateMatchTimeline(strong.team,weak.team,seed+i*7919);
  for(const e of timeline.events){
   if(!["GOAL","SAVE","MISS"].includes(e.eventType)) continue;
   const b=bands.find(item=>e.xg>=item.min&&e.xg<item.max)!;
   b.shots++;b.xg+=e.xg;b.xgSquared+=e.xg*e.xg;
   if(e.eventType==="GOAL"){b.goals++;b.onTarget++;}
   else if(e.eventType==="SAVE"){b.saves++;b.onTarget++;}
   else b.misses++;
  }
 }
 
 const xgBands: XgBandDiagnostic[]=bands.filter(b=>b.shots>0).map(b=>({band:b.label,shots:b.shots,averageXg:b.xg/b.shots,averageXgInterval:meanConfidenceInterval(b.xg,b.xgSquared,b.shots),onTargetRate:b.onTarget/b.shots,onTargetInterval:wilsonInterval(b.onTarget/b.shots,b.shots),goalRate:b.goals/b.shots,goalInterval:wilsonInterval(b.goals/b.shots,b.shots),saveRate:b.saves/b.shots,saveInterval:wilsonInterval(b.saves/b.shots,b.shots),missRate:b.misses/b.shots,missInterval:wilsonInterval(b.misses/b.shots,b.shots),goals:b.goals,saves:b.saves,misses:b.misses}));
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
 const outcomeRatesSum=baseline.homeWinRate+baseline.drawRate+baseline.awayWinRate;
 return {
  simulations,baseline,
  statisticalAcceptance:{
   method:"Wilson score interval",confidenceLevel:0.95,
   outcomes:{
    homeWin:wilsonInterval(baseline.homeWinRate,simulations),
    draw:wilsonInterval(baseline.drawRate,simulations),
    awayWin:wilsonInterval(baseline.awayWinRate,simulations),
   },
   outcomeRatesSum,outcomeRatesPartition:Math.abs(outcomeRatesSum-1)<=1e-9,
   interpretation:"These are Monte Carlo sampling-uncertainty intervals, not empirical football-calibration targets. Compare them with historical baselines before declaring the model calibrated.",
  },
  xgBands,
  eventProbabilities:MATCH_EVENT_PROBABILITIES,
  homeAdvantage:{clubA:strong.team.clubId,clubB:weak.team.clubId,clubAWinRateAtHome:ab.homeWinRate,clubAWinRateAway:ba.awayWinRate,homeAdvantageDelta:ab.homeWinRate-ba.awayWinRate,shotChanceBonus:HOME_SHOT_CHANCE_BONUS,note:"Explicit home advantage: +0.004 absolute shot-creation probability per minute for the home side. The win-rate delta is a seeded Monte Carlo estimate, not a guarantee."},
  strengthGap:{weakClubId:weak.team.clubId,strongClubId:strong.team.clubId,weakStrength:weak.value,strongStrength:strong.value,strengthDifference:strong.value-weak.value,hasMeaningfulGap:strong.value-weak.value>=8,note:strong.value-weak.value>=8?"Club ratings provide a useful strength contrast.":"Available clubs are too similar for a meaningful favorite-versus-underdog test; use a save with a larger ratings spread.",strongWinRate:baseline.homeWinRate,drawRate:baseline.drawRate,weakWinRate:baseline.awayWinRate,strongAverageGoals:baseline.averageHomeGoals,weakAverageGoals:baseline.averageAwayGoals},
  persistedMatches:{checked:persistedRows.length,issues,warnings}
 };
}



export interface TacticalSensitivityScenario {
 name:string;
 changedVariable:string;
 value:string|number;
 homeWinRate:number;
 homeWinRateDelta:number;
 averageHomeGoals:number;
 averageHomeGoalsDelta:number;
 homeShotsPerMatch:number;
 homeShotsDelta:number;
 averageTotalXg:number;
 averageTotalXgDelta:number;
}
export interface TacticalSensitivityReport {
 homeClubId:number;
 awayClubId:number;
 simulations:number;
 seed:number;
 baseline:MonteCarloReport;
 scenarios:TacticalSensitivityScenario[];
}

/** One-variable-at-a-time sensitivity analysis using common seeds for comparison. */
export function runTacticalSensitivityAnalysis(
 db:SqliteDatabase,homeClubId:number,awayClubId:number,simulations=1000,seed=73421,
):TacticalSensitivityReport {
 if(homeClubId===awayClubId) throw new Error("Sensitivity analysis requires two different clubs.");
 if(!Number.isSafeInteger(simulations)||simulations<100) throw new Error("Sensitivity simulations must be an integer >= 100.");
 const originalHome=loadTeam(db,-1,homeClubId,false),originalAway=loadTeam(db,-1,awayClubId,false);
 const baseline=runMonteCarlo(originalHome,originalAway,simulations,seed);
 const clone=(team:Team):Team=>({...team,tactic:{...team.tactic},lineup:team.lineup.map(player=>({...player})),...(team.context?{context:{...team.context}}:{})});
 const scenarios:Array<{name:string;changedVariable:string;value:string|number;home:Team}>=[];
 const tacticCase=(name:string,key:keyof Tactic,value:number|string)=>{
  const home=clone(originalHome);home.tactic={...home.tactic,[key]:value} as Tactic;scenarios.push({name,changedVariable:String(key),value,home});
 };
 tacticCase("pressing_low","pressing",20);tacticCase("pressing_high","pressing",80);
 tacticCase("tempo_low","tempo",20);tacticCase("tempo_high","tempo",80);
 tacticCase("defensive_line_low","defensive_line",20);tacticCase("defensive_line_high","defensive_line",80);
 tacticCase("width_low","width",20);tacticCase("width_high","width",80);
 tacticCase("passing_directness_low","passing_directness",20);tacticCase("passing_directness_high","passing_directness",80);
 tacticCase("counter_attack_off","counter_attack",0);tacticCase("counter_attack_on","counter_attack",1);
 tacticCase("mentality_defensive","mentality","DEFENSIVE");tacticCase("mentality_very_attacking","mentality","VERY_ATTACKING");
 for(const attribute of ["energy","morale","sharpness"] as const) for(const value of [20,80]) {
  const home=clone(originalHome);
  home.lineup=home.lineup.map(player=>player.isStarting?{...player,[attribute]:value}:player);
  refreshTeamStrength(home);
  scenarios.push({name:attribute+"_"+value,changedVariable:attribute,value,home});
 }
 for(const [name,contextPatch,value] of [
  ["weather_clear",{weather:"CLEAR"},"CLEAR"],
  ["weather_heavy_rain",{weather:"HEAVY_RAIN"},"HEAVY_RAIN"],
  ["pitch_poor",{pitchCondition:35},35],
  ["pitch_good",{pitchCondition:90},90],
  ["rest_short",{restHours:24},24],
  ["rest_full",{restHours:168},168],
  ["travel_none",{travelKm:0},0],
  ["travel_long",{travelKm:1200},1200],
 ] as Array<[string,Partial<MatchContext>,string|number]>) {
  const home=clone(originalHome);
  home.context={...(home.context??{weather:"CLEAR",temperatureC:20,pitchCondition:70,restHours:168,travelKm:0,travelHours:0}),...contextPatch} as MatchContext;
  scenarios.push({name,changedVariable:name.split("_")[0]!,value,home});
 }
 const keeperCase=clone(originalHome);
 const keeper=keeperCase.lineup.find(player=>player.isStarting&&player.role==="GK");
 if(keeper) {
  keeper.reflexes=95;keeper.handling=95;keeper.positioning=95;keeper.concentration=95;refreshTeamStrength(keeperCase);
  scenarios.push({name:"exceptional_goalkeeper",changedVariable:"goalkeeper attributes",value:95,home:keeperCase});
 }
 for(const value of [20,95]) {
  const finishingCase=clone(originalHome);
  const shooter=finishingCase.lineup.find(player=>player.isStarting&&player.role==="ST") ??
    finishingCase.lineup.find(player=>player.isStarting&&player.role!=="GK");
  if(shooter) {
    shooter.finishing=value;
    scenarios.push({name:"individual_finishing_"+value,changedVariable:"individual finishing",value,home:finishingCase});
  }
 }
 for(const value of [20,90]) {
  const defendingCase=clone(originalHome);
  const defender=defendingCase.lineup.find(player=>player.isStarting&&["CB","LB","RB","DM"].includes(player.role));
  if(defender) {
    defender.tackling=value;defender.marking=value;defender.positioning=value;
    refreshTeamStrength(defendingCase);
    scenarios.push({name:"individual_defending_"+value,changedVariable:"individual defensive attributes",value,home:defendingCase});
  }
 }
 const roleCase=clone(originalHome);
 const striker=roleCase.lineup.find(player=>player.isStarting&&player.role==="ST");
 if(striker) {
  striker.role="CM";refreshTeamStrength(roleCase);
  scenarios.push({name:"striker_role_changed_to_cm",changedVariable:"player role",value:"ST->CM",home:roleCase});
 }
 const alternateFormation=db.prepare("SELECT id FROM formation WHERE id<>? ORDER BY id LIMIT 1").get(originalHome.tactic.formation_id) as {id:number}|undefined;
 const formationCase=clone(originalHome);
 const starters=formationCase.lineup.filter(player=>player.isStarting);
 const keeper=starters.find(player=>player.role==="GK");
 const outfield=starters.filter(player=>player.role!=="GK");
 const slots=alternateFormation
  ? db.prepare("SELECT slot_number AS slot,position_code AS role FROM formation_slot WHERE formation_id=? ORDER BY slot_number").all(alternateFormation.id) as Array<{slot:number;role:string}>
  : ["CB","CB","LB","RB","DM","CM","CM","LW","RW","ST"].map((role,index)=>({slot:index+2,role}));
 const assigned:Array<{slot:number;role:string;player:MatchPlayer}>=[];
 let outfieldIndex=0;
 for(const slot of slots) {
  const player=slot.role==="GK"?keeper:outfield[outfieldIndex++];
  if(!player) continue;
  assigned.push({slot:slot.slot,role:slot.role,player});
 }
 if(assigned.length===11&&assigned.filter(item=>item.role==="GK"&&item.player.goalkeeper===1).length===1) {
  for(const item of assigned) {item.player.slot=item.slot;item.player.role=item.role;}
  formationCase.tactic={...formationCase.tactic,formation_id:alternateFormation?.id??(originalHome.tactic.formation_id+1)};
  refreshTeamStrength(formationCase);
  scenarios.push({name:"alternate_formation",changedVariable:"formation",value:alternateFormation?.id??"synthetic-role-layout",home:formationCase});
 }

 const rows=scenarios.map(s=>{
  const result=runMonteCarlo(s.home,originalAway,simulations,seed);
  return {name:s.name,changedVariable:s.changedVariable,value:s.value,
   homeWinRate:result.homeWinRate,homeWinRateDelta:result.homeWinRate-baseline.homeWinRate,
   averageHomeGoals:result.averageHomeGoals,averageHomeGoalsDelta:result.averageHomeGoals-baseline.averageHomeGoals,
   homeShotsPerMatch:result.homeShotRate,homeShotsDelta:result.homeShotRate-baseline.homeShotRate,
   averageTotalXg:result.averageTotalXg,averageTotalXgDelta:result.averageTotalXg-baseline.averageTotalXg};
 });
 return {homeClubId,awayClubId,simulations,seed,baseline,scenarios:rows};
}

export interface SeasonBalanceClub {
 clubId:number; reputation:number; strength:number; tier:string;
 averagePoints:number; averageGoalDifference:number; averageGoalsFor:number; averageGoalsAgainst:number;
 titleRate:number; topFourRate:number; bottomFourRate:number;
}
export interface SeasonBalanceReport {
 seasons:number; matchesPerSeason:number; totalMatches:number; seedStart:number;
 favoriteWinRate:number; underdogWinRate:number; drawRate:number; upsetDefinition:string;
 clubs:SeasonBalanceClub[]; tierSummary:Array<{tier:string;clubs:number;averagePoints:number;averageGoalDifference:number;averageGoalsAgainst:number}>;
}

/** Fast whole-season Monte Carlo: 16-club double round robin, repeated with distinct seeds. */
export function runSeasonBalanceAnalysis(db:SqliteDatabase,seasons=20,seedStart=90210):SeasonBalanceReport {
 if(!Number.isSafeInteger(seasons)||seasons<1||seasons>500)throw new Error("Season simulations must be an integer from 1 to 500.");
 const ids=(db.prepare("SELECT id FROM club ORDER BY id").all() as Array<{id:number}>).map(r=>r.id);
 if(ids.length<4)throw new Error("Season balance analysis requires at least four clubs.");
 const teams=ids.map(id=>loadTeam(db,-1,id,false));
 const strength=(t:Team)=>t.attacking*.4+t.defending*.35+t.goalkeeping*.25;
 const ranked=[...teams].sort((a,b)=>strength(b)-strength(a));
 const tierByClub=new Map<number,string>();
 ranked.forEach((t,i)=>tierByClub.set(t.clubId,i<3?"ELITE":i<7?"COMPETITIVE":i<12?"MID_TABLE":"LOWER_TABLE"));
 const stats=new Map(ids.map(id=>[id,{points:0,gd:0,gf:0,ga:0,first:0,topFour:0,bottomFour:0}]));
 let favoriteWins=0, favoriteDecisions=0, underdogWins=0, underdogDecisions=0, draws=0, totalMatches=0;
 for(let season=0;season<seasons;season++){
  const table=new Map(ids.map(id=>[id,{points:0,gf:0,ga:0}]));
  let matchIndex=0;
  for(let i=0;i<teams.length;i++)for(let j=i+1;j<teams.length;j++){
   const legs: Array<[number,number]> = [[i,j],[j,i]];
   for(const [homeIndex,awayIndex] of legs){
    const home=teams[homeIndex]!,away=teams[awayIndex]!;
    const result=simulateMatchKernel(home,away,(seedStart+season*1000003+matchIndex*7919)>>>0);
    matchIndex++;totalMatches++;
    const h=table.get(home.clubId)!,a=table.get(away.clubId)!;
    h.gf+=result.homeScore;h.ga+=result.awayScore;a.gf+=result.awayScore;a.ga+=result.homeScore;
    if(result.homeScore>result.awayScore)h.points+=3;
    else if(result.homeScore<result.awayScore)a.points+=3;
    else {h.points++;a.points++;draws++;}
    const gap=strength(home)-strength(away);
    if(Math.abs(gap)>=5){favoriteDecisions++;const favoriteWon=gap>0?result.homeScore>result.awayScore:result.awayScore>result.homeScore;if(favoriteWon)favoriteWins++;}
    if(Math.abs(gap)>=8){underdogDecisions++;const underdogWon=gap>0?result.awayScore>result.homeScore:result.homeScore>result.awayScore;if(underdogWon)underdogWins++;}
   }
  }
  const ordered=[...table.entries()].sort((a,b)=>b[1].points-a[1].points||(b[1].gf-b[1].ga)-(a[1].gf-a[1].ga)||b[1].gf-a[1].gf);
  ordered.forEach(([id,row],rank)=>{const acc=stats.get(id)!;acc.points+=row.points;acc.gf+=row.gf;acc.ga+=row.ga;acc.gd+=row.gf-row.ga;if(rank===0)acc.first++;if(rank<4)acc.topFour++;if(rank>=ordered.length-4)acc.bottomFour++;});
 }
 const clubs:SeasonBalanceClub[]=ids.map(id=>{
  const team=teams.find(t=>t.clubId===id)!;const s=stats.get(id)!;
  return {clubId:id,reputation:team.reputation,strength:strength(team),tier:tierByClub.get(id)!,
   averagePoints:s.points/seasons,averageGoalDifference:s.gd/seasons,averageGoalsFor:s.gf/seasons,averageGoalsAgainst:s.ga/seasons,
   titleRate:s.first/seasons,topFourRate:s.topFour/seasons,bottomFourRate:s.bottomFour/seasons};
 }).sort((a,b)=>b.averagePoints-a.averagePoints);
 const tierSummary=["ELITE","COMPETITIVE","MID_TABLE","LOWER_TABLE"].map(tier=>{
  const group=clubs.filter(c=>c.tier===tier);
  return {tier,clubs:group.length,averagePoints:group.reduce((sum,c)=>sum+c.averagePoints,0)/(group.length||1),
   averageGoalDifference:group.reduce((sum,c)=>sum+c.averageGoalDifference,0)/(group.length||1),
   averageGoalsAgainst:group.reduce((sum,c)=>sum+c.averageGoalsAgainst,0)/(group.length||1)};
 });
 return {seasons,matchesPerSeason:teams.length*(teams.length-1),totalMatches,seedStart,
  favoriteWinRate:favoriteDecisions?favoriteWins/favoriteDecisions:0,
  underdogWinRate:underdogDecisions?underdogWins/underdogDecisions:0,
  drawRate:totalMatches?draws/totalMatches:0,
  upsetDefinition:"Favorite/underdog comparisons use a pre-match strength gap of at least 5/8 rating points; ties are not wins.",
  clubs,tierSummary};
}

export function scheduleMatchTacticalChange(db:SqliteDatabase,fixtureId:number,clubId:number,minute:number,changeType:"MENTALITY"|"INSTRUCTION"|"SUBSTITUTION"|"FORMATION",payload:Record<string,unknown>):number{
 if(!Number.isSafeInteger(minute)||minute<1||minute>90)throw new Error("Tactical change minute must be between 1 and 90.");
 const fixture=db.prepare("SELECT status,current_minute AS currentMinute,home_club_id AS home,away_club_id AS away,scheduled_at AS scheduledAt FROM fixture WHERE id=?").get(fixtureId) as {status:string;currentMinute:number;home:number;away:number;scheduledAt:string|null}|undefined;
 if(!fixture)throw new Error("Fixture not found.");
 if(!["SCHEDULED","IN_PROGRESS"].includes(fixture.status))throw new Error("Tactical changes require a scheduled or in-progress fixture.");
 if(clubId!==fixture.home&&clubId!==fixture.away)throw new Error("Club is not part of this fixture.");
 if(fixture.status==="IN_PROGRESS"&&minute<=fixture.currentMinute)throw new Error("Cannot schedule a change at or before the current minute.");
 if(changeType==="MENTALITY"&&!["VERY_DEFENSIVE","DEFENSIVE","BALANCED","ATTACKING","VERY_ATTACKING"].includes(String(payload.mentality??"")))throw new Error("Invalid mentality.");
 if(changeType==="INSTRUCTION"){
  const key=String(payload.key??""),value=Number(payload.value);
  const ranges:Record<string,[number,number]>={pressing:[0,100],tempo:[0,100],defensive_line:[0,100],width:[0,100],passing_directness:[0,100],counter_attack:[0,1]};
  if(!ranges[key]||!Number.isFinite(value)||value<ranges[key]![0]||value>ranges[key]![1])throw new Error("Invalid instruction key or value.");
 }
 if(changeType==="FORMATION"){
  loadTeam(db,fixtureId,clubId);
  const formationId=Number(payload.formationId);
  if(!db.prepare("SELECT 1 FROM formation WHERE id=?").get(formationId))throw new Error("Formation does not exist.");
  const slots=db.prepare("SELECT slot_number AS slotNumber,position_code AS positionCode FROM formation_slot WHERE formation_id=? ORDER BY slot_number").all(formationId) as Array<{slotNumber:number;positionCode:string}>;
  const starters=db.prepare("SELECT ml.player_id AS playerId,p.goalkeeper AS goalkeeper FROM match_lineup ml JOIN player p ON p.person_id=ml.player_id WHERE ml.fixture_id=? AND ml.club_id=? AND ml.is_starting=1 ORDER BY ml.slot_number").all(fixtureId,clubId) as Array<{playerId:number;goalkeeper:number}>;
  if(slots.length!==11||starters.length!==11||slots.filter(slot=>slot.positionCode==="GK").length!==1)throw new Error("Formation changes require eleven starters and exactly one goalkeeper slot.");
  const keeper=starters.find(player=>player.goalkeeper===1);
  if(!keeper)throw new Error("Current lineup has no goalkeeper.");
  const outfield=starters.filter(player=>player.goalkeeper!==1);
  let outfieldIndex=0;
  payload={formationId,slots:slots.map(slot=>({slotNumber:slot.slotNumber,positionCode:slot.positionCode,playerId:slot.positionCode==="GK"?keeper.playerId:outfield[outfieldIndex++]!.playerId}))};
 }
 if(changeType==="SUBSTITUTION"){
  loadTeam(db,fixtureId,clubId);
  const playerOutId=Number(payload.playerOutId),playerInId=Number(payload.playerInId);
  if(!Number.isSafeInteger(playerOutId)||!Number.isSafeInteger(playerInId)||playerOutId===playerInId)throw new Error("Substitution requires different playerOutId and playerInId.");
  const outgoing=db.prepare("SELECT p.goalkeeper AS goalkeeper FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id WHERE sm.player_id=? AND sm.club_id=?").get(playerOutId,clubId) as {goalkeeper:number}|undefined;
  const incoming=db.prepare("SELECT p.goalkeeper AS goalkeeper,COALESCE(pc.suspension_matches,0) AS suspension,pc.injured_until AS injuredUntil FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id LEFT JOIN player_condition pc ON pc.player_id=p.person_id WHERE sm.player_id=? AND sm.club_id=?").get(playerInId,clubId) as {goalkeeper:number;suspension:number;injuredUntil:string|null}|undefined;
  if(!outgoing||!incoming)throw new Error("Both players must belong to the selected club.");
  const lineupState=db.prepare("SELECT player_id AS playerId,is_starting AS isStarting FROM match_lineup WHERE fixture_id=? AND club_id=? AND player_id IN (?,?)").all(fixtureId,clubId,playerOutId,playerInId) as Array<{playerId:number;isStarting:number}>;
  if(lineupState.length!==2||lineupState.find(p=>p.playerId===playerOutId)?.isStarting!==1||lineupState.find(p=>p.playerId===playerInId)?.isStarting!==0)throw new Error("Select a current starter and a saved bench player before scheduling a substitution.");
  const matchDate=fixture.scheduledAt?.slice(0,10)??null;
  if(incoming.suspension>0||(incoming.injuredUntil&&matchDate&&incoming.injuredUntil>=matchDate))throw new Error("Incoming player is unavailable.");
  if(outgoing.goalkeeper===1&&incoming.goalkeeper!==1)throw new Error("A goalkeeper can only be replaced by another goalkeeper.");
  payload={playerOutId,playerInId};
 }
 return Number(db.prepare("INSERT INTO match_tactical_change(fixture_id,minute,club_id,change_type,payload) VALUES(?,?,?,?,?)").run(fixtureId,minute,clubId,changeType,JSON.stringify(payload)).lastInsertRowid);
}

export function simulateMatch(db:SqliteDatabase,fixtureId:number):MatchSummary {
 const f=db.prepare("SELECT id,home_club_id,away_club_id,random_seed,status FROM fixture WHERE id=?").get(fixtureId) as FixtureRow|undefined;
 if(!f)throw new Error(`Fixture ${fixtureId} not found.`);
 if(f.status==="COMPLETED")throw new Error(`Fixture ${fixtureId} is already completed.`);
 if(f.status==="CANCELLED"||f.status==="POSTPONED")throw new Error(`Fixture ${fixtureId} is not playable (status: ${f.status}).`);
 if(f.status!=="SCHEDULED"&&f.status!=="IN_PROGRESS")throw new Error(`Fixture ${fixtureId} cannot be played from status ${f.status}.`);
 const seed=f.random_seed??(f.id*2654435761>>>0);
 const hasCheckpoint=Boolean(db.prepare("SELECT 1 FROM match_simulation_state WHERE fixture_id=?").get(fixtureId));
 if(!hasCheckpoint)recoverSquadBeforeMatch(db,fixtureId,f.home_club_id,f.away_club_id);
 const context=resolveMatchContext(db,fixtureId,f.home_club_id);
 persistMatchEnvironment(db,fixtureId,context);
 const home=loadTeam(db,fixtureId,f.home_club_id),away=loadTeam(db,fixtureId,f.away_club_id);
 const changes=db.prepare("SELECT id,minute,club_id,change_type,payload FROM match_tactical_change WHERE fixture_id=? ORDER BY minute,id").all(fixtureId) as TacticalChange[];
 const initiallyStartingPlayerIds=new Set([...home.lineup,...away.lineup].filter(player=>player.isStarting).map(player=>player.id));
 const timeline=simulateMatchTimeline(home,away,seed,changes);
 const simulationConfig = {
  home: {clubId:home.clubId,tactic:home.tactic,context:home.context,
   lineup:home.lineup.map(p=>({id:p.id,role:p.role,slot:p.slot,isStarting:p.isStarting,positionRating:p.positionRating}))},
  away: {clubId:away.clubId,tactic:away.tactic,context:away.context,
   lineup:away.lineup.map(p=>({id:p.id,role:p.role,slot:p.slot,isStarting:p.isStarting,positionRating:p.positionRating}))},
  tacticalChanges:changes.map(change=>({id:change.id,minute:change.minute,clubId:change.club_id,type:change.change_type,payload:change.payload})),
 };
 const existing=db.prepare("SELECT simulation_minute,state_json FROM match_simulation_state WHERE fixture_id=?")
  .get(fixtureId) as {simulation_minute:number;state_json:string}|undefined;
 let startMinute=existing?.simulation_minute??0;
 if(existing){
  let checkpoint:{seed?:number;completed?:boolean;config?:unknown};
  try{checkpoint=JSON.parse(existing.state_json) as {seed?:number;completed?:boolean};}
  catch{throw new Error(`Fixture ${fixtureId} has an invalid simulation checkpoint; refusing to overwrite it.`);}
  if(checkpoint.seed!==seed)throw new Error(`Fixture ${fixtureId} checkpoint seed does not match its fixture seed.`);
  if(checkpoint.config!==undefined && JSON.stringify(checkpoint.config)!==JSON.stringify(simulationConfig)) {
   throw new Error(`Fixture ${fixtureId} simulation inputs changed after its checkpoint; refusing a non-deterministic resume.`);
  }
  if(startMinute<0||startMinute>90)throw new Error(`Fixture ${fixtureId} checkpoint minute is invalid.`);
 }else if(f.status==="IN_PROGRESS"){
  throw new Error(`Fixture ${fixtureId} is IN_PROGRESS but has no checkpoint; manual repair is required.`);
 }
 if(!existing){
  const begin=db.transaction(()=>{
   // Acquire the write lock before checking the transition. A concurrent caller
   // must never reset another worker's checkpoint/events after it has started.
   const current=db.prepare("SELECT status FROM fixture WHERE id=?").get(fixtureId) as {status:string}|undefined;
   if(!current || current.status!=="SCHEDULED") throw new Error(`Fixture ${fixtureId} changed state before simulation could start.`);
   if(db.prepare("SELECT 1 FROM match_simulation_state WHERE fixture_id=?").get(fixtureId)) {
    throw new Error(`Fixture ${fixtureId} already has a simulation checkpoint; refusing destructive reinitialization.`);
   }
   db.prepare("INSERT INTO match_event(fixture_id,minute,event_type,xg,description) VALUES(?,0,'KICK_OFF',0,'Partida iniciada')").run(fixtureId);
   db.prepare("INSERT INTO match_simulation_state(fixture_id,state_version,simulation_minute,state_json) VALUES(?,1,0,?)")
    .run(fixtureId,JSON.stringify({engineVersion:"1.0.0",seed,config:simulationConfig,minute:0,homeScore:0,awayScore:0,completed:false}));
   const claimed=db.prepare("UPDATE fixture SET status='IN_PROGRESS',random_seed=?,current_minute=0,home_score=0,away_score=0 WHERE id=? AND status='SCHEDULED'").run(seed,fixtureId);
   if(claimed.changes!==1) throw new Error(`Fixture ${fixtureId} could not be claimed for simulation.`);
  });
  begin.immediate();
 }
 const insertEvent=db.prepare("INSERT INTO match_event(fixture_id,minute,club_id,player_id,secondary_player_id,event_type,xg,description) VALUES(?,?,?,?,?,?,?,?)");
 const insertMomentum=db.prepare("INSERT INTO match_momentum(fixture_id,minute,home_pressure,away_pressure,home_score,away_score) VALUES(?,?,?,?,?,?)");
 const checkpoint=db.prepare("UPDATE match_simulation_state SET simulation_minute=?,state_json=?,updated_at=CURRENT_TIMESTAMP WHERE fixture_id=?");
 const minuteUpdate=db.transaction((m:KernelMinute)=>{
  for(const e of m.events)insertEvent.run(fixtureId,e.minute,e.clubId,e.playerId||null,e.secondaryPlayerId,e.eventType,e.xg,e.description);
  insertMomentum.run(fixtureId,m.minute,m.homePressure,m.awayPressure,m.homeScore,m.awayScore);
  checkpoint.run(m.minute,JSON.stringify({engineVersion:"1.0.0",seed,config:simulationConfig,minute:m.minute,homeScore:m.homeScore,awayScore:m.awayScore,
   homeShots:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.home_club_id&&["GOAL","SAVE","MISS"].includes(e.eventType)).length,
   awayShots:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.away_club_id&&["GOAL","SAVE","MISS"].includes(e.eventType)).length,
   homeShotsOnTarget:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.home_club_id&&(e.eventType==="GOAL"||e.eventType==="SAVE")).length,
   awayShotsOnTarget:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.away_club_id&&(e.eventType==="GOAL"||e.eventType==="SAVE")).length,
   homePressure:m.homePressure,awayPressure:m.awayPressure,
   homeXg:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.home_club_id&&["GOAL","SAVE","MISS"].includes(e.eventType)).reduce((n,e)=>n+e.xg,0),
   awayXg:timeline.events.filter(e=>e.minute<=m.minute&&e.clubId===f.away_club_id&&["GOAL","SAVE","MISS"].includes(e.eventType)).reduce((n,e)=>n+e.xg,0),
   completed:false}),fixtureId);
  db.prepare("UPDATE fixture SET status='IN_PROGRESS',current_minute=?,home_score=?,away_score=? WHERE id=?")
   .run(m.minute,m.homeScore,m.awayScore,fixtureId);
 });
 for(const m of timeline.minutes)if(m.minute>startMinute)minuteUpdate.immediate(m);
 const finalise=db.transaction(()=>{
  const alreadyFullTime=db.prepare("SELECT 1 FROM match_event WHERE fixture_id=? AND event_type='FULL_TIME'").get(fixtureId);
  if(!alreadyFullTime)insertEvent.run(fixtureId,90,null,null,null,"FULL_TIME",0,"Fim de jogo");
  db.prepare("DELETE FROM match_player_state WHERE fixture_id=?").run(fixtureId);
  db.prepare("UPDATE match_tactical_change SET applied=1 WHERE fixture_id=?").run(fixtureId);
  const state=db.prepare("INSERT INTO match_player_state(fixture_id,player_id,club_id,energy,rating,minutes_played) VALUES(?,?,?,?,?,?)");
  for(const team of [home,away])for(const p of team.lineup){
   const substitutionOut=timeline.events.find(e=>e.eventType==="SUBSTITUTION"&&e.playerId===p.id);
   const substitutionIn=timeline.events.find(e=>e.eventType==="SUBSTITUTION"&&e.secondaryPlayerId===p.id);
   const injury=timeline.events.find(e=>e.eventType==="INJURY"&&e.playerId===p.id);
   const redCard=timeline.events.find(e=>e.eventType==="RED_CARD"&&e.playerId===p.id);
   const wasStarter=initiallyStartingPlayerIds.has(p.id);
   const exitEvent=substitutionOut??injury??redCard;
   const loss=wasStarter?(exitEvent?9:14):(substitutionIn?7:2);
   const minutesPlayed=wasStarter?(exitEvent?exitEvent.minute:90):(substitutionIn?90-substitutionIn.minute:0);
   state.run(fixtureId,p.id,team.clubId,Math.max(0,p.energy-loss),p.isStarting?6.3:6,minutesPlayed);
   db.prepare("UPDATE player_condition SET energy=MAX(0,energy-?) WHERE player_id=?").run(loss,p.id);
   if(p.isStarting){
    const delta=timeline.result.homeScore===timeline.result.awayScore?0:
     (team.clubId===f.home_club_id?(timeline.result.homeScore>timeline.result.awayScore?2:-2):
      (timeline.result.awayScore>timeline.result.homeScore?2:-2));
    db.prepare("UPDATE player_condition SET morale=MIN(100,MAX(0,morale+?)) WHERE player_id=?").run(delta,p.id);
   }
  }
  db.prepare("UPDATE player_condition SET suspension_matches=MAX(0,suspension_matches-1) WHERE player_id IN (SELECT player_id FROM squad_membership WHERE club_id IN (?,?)) AND suspension_matches>0").run(f.home_club_id,f.away_club_id);
  for(const incident of timeline.events.filter(event=>event.eventType==="INJURY"&&event.playerId>0)) {
   db.prepare("UPDATE player_condition SET injured_until=COALESCE(date((SELECT substr(scheduled_at,1,10) FROM fixture WHERE id=?),'+'||?||' days'),date('now','+'||?||' days')) WHERE player_id=?")
    .run(fixtureId,incident.injuryDays??7,incident.injuryDays??7,incident.playerId);
  }
  for(const incident of timeline.events.filter(event=>event.eventType==="RED_CARD"&&event.playerId>0)) {
   db.prepare("UPDATE player_condition SET suspension_matches=MAX(suspension_matches,1) WHERE player_id=?").run(incident.playerId);
  }
  const yellowPlayers=[...new Set(timeline.events.filter(event=>event.eventType==="YELLOW_CARD"&&event.playerId>0).map(event=>event.playerId))];
  for(const playerId of yellowPlayers) {
   const count=(db.prepare(`SELECT COUNT(*) AS count FROM match_event e
    JOIN fixture f ON f.id=e.fixture_id JOIN competition_round r ON r.id=f.round_id
    JOIN competition_stage st ON st.id=r.stage_id
    WHERE e.player_id=? AND e.event_type='YELLOW_CARD'
      AND st.season_id=(SELECT st2.season_id FROM fixture f2 JOIN competition_round r2 ON r2.id=f2.round_id JOIN competition_stage st2 ON st2.id=r2.stage_id WHERE f2.id=?)
      AND (f.status='COMPLETED' OR f.id=?)`).get(playerId,fixtureId,fixtureId) as {count:number}).count;
   if(count>0&&count%5===0) db.prepare("UPDATE player_condition SET suspension_matches=MAX(suspension_matches,1) WHERE player_id=?").run(playerId);
  }
  db.prepare("UPDATE fixture SET status='COMPLETED',current_minute=90,home_score=?,away_score=? WHERE id=?")
   .run(timeline.result.homeScore,timeline.result.awayScore,fixtureId);
  checkpoint.run(90,JSON.stringify({engineVersion:"1.0.0",seed,config:simulationConfig,minute:90,homeScore:timeline.result.homeScore,
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


export interface SyntheticScaleBenchmark {
  clubs: number;
  matches: number;
  seed: number;
  durationMs: number;
  matchesPerSecond: number;
  averageGoalsPerMatch: number;
  drawRate: number;
}

/**
 * Reproducible CPU-only scalability benchmark. Teams beyond the real save size
 * reuse immutable squad/tactic profiles from that save, with unique synthetic
 * club IDs. It measures engine throughput, not the cost of generating 256 real
 * squads or persisting a 256-club database.
 */
export function runSyntheticSeasonScaleBenchmarks(
  db: SqliteDatabase,
  sizes: number[] = [16, 64, 256],
  seed = 90210,
): SyntheticScaleBenchmark[] {
  if (!sizes.length || sizes.some(size => !Number.isSafeInteger(size) || size < 4 || size > 512)) {
    throw new Error("Benchmark scales must contain club counts between 4 and 512.");
  }
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("Benchmark seed must be a non-negative integer.");
  const ids = (db.prepare("SELECT id FROM club ORDER BY id").all() as Array<{id:number}>).map(row => row.id);
  if (ids.length < 4) throw new Error("Scalability benchmarks require at least four source clubs.");
  const templates = ids.map(id => loadTeam(db, -1, id, false));
  return [...new Set(sizes)].sort((a,b)=>a-b).map(clubs => {
    const teams: Team[] = Array.from({length:clubs}, (_,index) => {
      const template = templates[index % templates.length]!;
      return {...template, clubId:index + 1, tactic:{...template.tactic}, lineup:template.lineup.map(player=>({...player}))};
    });
    let state = 0, goals = 0, draws = 0;
    const matches = clubs * (clubs - 1);
    const started = performance.now();
    let matchIndex = 0;
    for (let homeIndex=0;homeIndex<clubs;homeIndex++) {
      for (let awayIndex=0;awayIndex<clubs;awayIndex++) {
        if (homeIndex === awayIndex) continue;
        const result = simulateMatchKernel(teams[homeIndex]!,teams[awayIndex]!,
          (seed + clubs * 1000003 + matchIndex * 7919) >>> 0);
        goals += result.homeScore + result.awayScore;
        if (result.homeScore === result.awayScore) draws++;
        matchIndex++;
      }
    }
    const durationMs = performance.now() - started;
    state = matchIndex;
    if (state !== matches) throw new Error("Synthetic benchmark match-count invariant failed.");
    return {clubs,matches,seed,durationMs,matchesPerSecond:durationMs > 0 ? matches/(durationMs/1000) : matches,
      averageGoalsPerMatch:goals/matches,drawRate:draws/matches};
  });
}
