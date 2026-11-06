import {
  MATCH_EVENT_PROBABILITIES,
} from "./constants.js";
import {
  clamp,
  mean,
  rng,
} from "./mathUtils.js";
import {
  goalConversionProbability,
  onTargetProbability,
  sampleChanceQuality,
  shotCreationProbability,
  teamPressure,
} from "./probabilityModel.js";
import {
  refreshTeamStrength,
} from "./strengthCalculator.js";
import type {
    KernelMinute,
  KernelShotEvent,
  KernelTimeline,
  SimulatedMatchResult,
  TacticalChange,
  Team,
} from "./types.js";


export function simulateMatchTimeline(
  home: Team,
  away: Team,
  seed: number,
  changes: TacticalChange[] = []
): KernelTimeline {
  home={...home,tactic:{...home.tactic},lineup:home.lineup.map(p=>({...p}))};
   away={...away,tactic:{...away.tactic},lineup:away.lineup.map(p=>({...p}))};
   const homeRandom=rng(seed ^ Math.imul(home.clubId,0x9e3779b1));
   const awayRandom=rng(seed ^ Math.imul(away.clubId,0x9e3779b1));
   const homeEventRandom=rng((seed ^ Math.imul(home.clubId,0x85ebca6b) ^ 0x51ed270b)>>>0);
   const awayEventRandom=rng((seed ^ Math.imul(away.clubId,0x85ebca6b) ^ 0x51ed270b)>>>0);
   const homeErrorRandom=rng((seed ^ Math.imul(home.clubId,0xc2b2ae35) ^ 0x27d4eb2f)>>>0);
   const awayErrorRandom=rng((seed ^ Math.imul(away.clubId,0xc2b2ae35) ^ 0x27d4eb2f)>>>0);
   let hs=0,as=0,hShots=0,aShots=0,hOn=0,aOn=0,hxg=0,axg=0;
   const events:KernelShotEvent[]=[];
   const minutes:KernelMinute[]=[];
   const changesByMinute=new Map<number,TacticalChange[]>();
   for(const change of changes) {
    const list=changesByMinute.get(change.minute)??[];
    list.push(change);changesByMinute.set(change.minute,list);
   }
   const substitutionsByClub=new Map<number,number>([[home.clubId,0],[away.clubId,0]]);
   for(let minute=1;minute<=90;minute++){
    const minuteEvents:KernelShotEvent[]=[];
    for(const change of changesByMinute.get(minute)??[]){
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
      substitutionsByClub.set(team.clubId,(substitutionsByClub.get(team.clubId)??0)+1);
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
        substitutionsByClub.set(incident.team.clubId,(substitutionsByClub.get(incident.team.clubId)??0)+1);
       }
       refreshTeamStrength(incident.team);
      }
     }
     const substitutionsUsed=substitutionsByClub.get(incident.team.clubId)??0;
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
       substitutionsByClub.set(incident.team.clubId,(substitutionsByClub.get(incident.team.clubId)??0)+1);
      }
     }
    }
    const hp=teamPressure(home,homeRandom),ap=teamPressure(away,awayRandom);
    for(const side of [
      {team:home,opponent:away,isHome:true,pressure:hp,opponentPressure:ap,random:homeRandom,opponentErrorRandom:awayErrorRandom},
      {team:away,opponent:home,isHome:false,pressure:ap,opponentPressure:hp,random:awayRandom,opponentErrorRandom:homeErrorRandom},
    ]){
     const tactic=side.team.tactic;
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


export function simulateMatchKernel(
  home: Team,
  away: Team,
  seed: number
): SimulatedMatchResult {
  return simulateMatchTimeline(
    home,
    away,
    seed
  ).result;
}