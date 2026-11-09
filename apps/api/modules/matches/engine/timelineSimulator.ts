import {
  MATCH_EVENT_PROBABILITIES,
} from "./constants.js";
import { advanceMatchGameState, createMatchGameState } from "./game-state/gameState.calculator.js";
import { resolveTeamGameActions } from "./game-state/gameActionResolver.js";
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
  MomentumMinuteTrace,
  SimulatedMatchResult,
  TacticalChange,
  Team,
} from "../types/match-engine.types.js";


export function simulateMatchTimeline(
  home: Team,
  away: Team,
  seed: number,
  changes: TacticalChange[] = [],
  options: { collectMomentumTrace?: boolean } = {},
): KernelTimeline {
  validateTeamForSimulation(home);
  validateTeamForSimulation(away);
  if (home.clubId === away.clubId) {
    throw new Error("A match requires two different clubs.");
  }
  if (!Number.isSafeInteger(seed)) {
    throw new Error("Match seed must be a safe integer.");
  }

  home = { ...home, tactic: { ...home.tactic }, lineup: home.lineup.map(player => ({ ...player })) };
  away = { ...away, tactic: { ...away.tactic }, lineup: away.lineup.map(player => ({ ...player })) };
   const homeRandom=rng(seed ^ Math.imul(home.clubId,0x9e3779b1));
   const awayRandom=rng(seed ^ Math.imul(away.clubId,0x9e3779b1));
   const homeEventRandom=rng((seed ^ Math.imul(home.clubId,0x85ebca6b) ^ 0x51ed270b)>>>0);
   const awayEventRandom=rng((seed ^ Math.imul(away.clubId,0x85ebca6b) ^ 0x51ed270b)>>>0);
   const homeErrorRandom=rng((seed ^ Math.imul(home.clubId,0xc2b2ae35) ^ 0x27d4eb2f)>>>0);
   const awayErrorRandom=rng((seed ^ Math.imul(away.clubId,0xc2b2ae35) ^ 0x27d4eb2f)>>>0);
   const homeGameRandom=rng((seed ^ Math.imul(home.clubId,0x27d4eb2f) ^ 0x165667b1)>>>0);
   const awayGameRandom=rng((seed ^ Math.imul(away.clubId,0x27d4eb2f) ^ 0x165667b1)>>>0);
   let hs=0,as=0,hShots=0,aShots=0,hOn=0,aOn=0,hxg=0,axg=0;
   let gameState = createMatchGameState(home, away);
   const events:KernelShotEvent[]=[];
   const minutes:KernelMinute[]=[];
   const changesByMinute=new Map<number,TacticalChange[]>();
   const orderedChanges = [...changes].sort(
    (left, right) => left.minute - right.minute || left.id - right.id
   );
   for (const change of orderedChanges) {
    if (!Number.isSafeInteger(change.minute) || change.minute < 1 || change.minute > 90) {
      throw new Error(`Tactical change ${change.id} has an invalid minute.`);
    }
    if (change.club_id !== home.clubId && change.club_id !== away.clubId) {
      throw new Error(`Tactical change ${change.id} targets a club outside the fixture.`);
    }
    const list = changesByMinute.get(change.minute) ?? [];
    list.push(change);
    changesByMinute.set(change.minute, list);
   }
   const substitutionsByClub=new Map<number,number>([[home.clubId,0],[away.clubId,0]]);
   const playersWhoHavePlayed=new Set([...home.lineup,...away.lineup].filter(player=>player.isStarting).map(player=>player.id));
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
      const outgoing=team.lineup.find(p=>p.id===outId),incoming=team.lineup.find(p=>p.id===inId);
      // A player can become unavailable after a decision is scheduled
      // (for example, a late injury or roster change before kickoff).
      // Cancel the decision instead of aborting the entire match.
      if(!outgoing||!incoming){
       minuteEvents.push({minute,clubId:team.clubId,playerId:outId,secondaryPlayerId:inId,eventType:"TACTIC_CHANGE",xg:0,description:"Substituição cancelada: jogador indisponível para esta partida"});
      }else{
       // A planned substitution can be invalidated by an earlier injury,
       // dismissal or automatic substitution. That is a football outcome, not
       // a corrupt match: record the cancelled decision and keep simulating.
       const substitutionsUsed=substitutionsByClub.get(team.clubId)??0;
       if(!outgoing.isStarting||incoming.isStarting||playersWhoHavePlayed.has(incoming.id)||substitutionsUsed>=3){
        const reason=substitutionsUsed>=3
         ? "limite de três substituições atingido"
         : playersWhoHavePlayed.has(incoming.id)
          ? "jogador já participou da partida e não pode reentrar"
          : "jogador já não está na condição prevista";
        minuteEvents.push({minute,clubId:team.clubId,playerId:outgoing.id,secondaryPlayerId:incoming.id,eventType:"TACTIC_CHANGE",xg:0,description:`Substituição cancelada: ${reason}`});
       }else{
        if(outgoing.goalkeeper!==incoming.goalkeeper)throw new Error("A goalkeeper can only be replaced by another goalkeeper, and outfield players must replace outfield players.");
        incoming.role=outgoing.role;incoming.slot=outgoing.slot;incoming.isStarting=true;outgoing.isStarting=false;playersWhoHavePlayed.add(incoming.id);refreshTeamStrength(team);
        minuteEvents.push({minute,clubId:team.clubId,playerId:outgoing.id,secondaryPlayerId:incoming.id,eventType:"SUBSTITUTION",xg:0,description:`Substituição: ${outgoing.name} sai, ${incoming.name} entra`});
        substitutionsByClub.set(team.clubId,(substitutionsByClub.get(team.clubId)??0)+1);
       }
      }
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
      const assignments = slots as Array<Record<string, unknown>>;
      const assignedPlayers = new Set<number>();
      const assignedSlots = new Set<number>();
      const parsedAssignments = assignments.map(raw => {
       const playerId = Number(raw.playerId);
       const slot = Number(raw.slotNumber);
       const role = String(raw.positionCode ?? "");
       const player = team.lineup.find(candidate => candidate.id === playerId);
       if (
        !Number.isSafeInteger(playerId) ||
        playerId <= 0 ||
        assignedPlayers.has(playerId) ||
        !Number.isSafeInteger(slot) ||
        slot < 1 ||
        slot > 11 ||
        assignedSlots.has(slot) ||
        !["GK","CB","LB","RB","LWB","RWB","DM","CM","AM","LW","RW","LM","RM","ST"].includes(role) ||
        (role === "GK" && player && player.goalkeeper !== 1)
       ) {
        throw new Error(`Formation change ${change.id} has invalid slot assignments.`);
       }
       assignedPlayers.add(playerId);
       assignedSlots.add(slot);
       return { slot, role };
      });
      if (
       assignedPlayers.size !== 11 ||
       assignedSlots.size !== 11 ||
       parsedAssignments.filter(assignment => assignment.role === "GK").length !== 1
      ) {
       throw new Error("Formation change must assign eleven distinct players, eleven distinct slots and exactly one goalkeeper.");
      }
      const formationId = Number(payload.formationId);
      if (!Number.isSafeInteger(formationId) || formationId <= 0) {
       throw new Error(`Formation change ${change.id} has an invalid formation id.`);
      }

      // The saved formation plan may have been invalidated by red cards,
      // injuries or automatic substitutions. Reposition the current XI rather
      // than reintroducing a player who has already left the pitch.
      const activePlayers = team.lineup.filter(player => player.isStarting).sort((a,b)=>a.slot-b.slot);
      const keepers = activePlayers.filter(player => player.goalkeeper === 1);
      if(activePlayers.length!==11||keepers.length!==1){
       minuteEvents.push({minute,clubId:team.clubId,playerId:0,secondaryPlayerId:null,eventType:"TACTIC_CHANGE",xg:0,description:"Formação não aplicada: o número de jogadores em campo mudou antes da alteração"});
      }else{
       const keeper=keepers[0]!;
       const outfield=activePlayers.filter(player=>player.goalkeeper!==1);
       let outfieldIndex=0;
       for(const player of team.lineup) player.isStarting=false;
       for(const assignment of parsedAssignments.sort((a,b)=>a.slot-b.slot)){
        const player=assignment.role==="GK"?keeper:outfield[outfieldIndex++]!;
        player.isStarting=true;
        player.slot=assignment.slot;
        player.role=assignment.role;
       }
       team.tactic = { ...team.tactic, formation_id: formationId };
       refreshTeamStrength(team);
       minuteEvents.push({minute,clubId:team.clubId,playerId:0,secondaryPlayerId:null,eventType:"TACTIC_CHANGE",xg:0,description:"Formação alterada durante a partida"});
      }
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
       if (secondYellow) {
        const secondYellowEvent: KernelShotEvent = {
         minute,
         clubId: incident.team.clubId,
         playerId: player.id,
         secondaryPlayerId: null,
         eventType: "YELLOW_CARD",
         xg: 0,
         description: `Segundo cartão amarelo para ${player.name}`,
        };
        minuteEvents.push(secondYellowEvent);
        events.push(secondYellowEvent);
        player.isStarting = false;
        refreshTeamStrength(incident.team);
        const redCardEvent: KernelShotEvent = {
         minute,
         clubId: incident.team.clubId,
         playerId: player.id,
         secondaryPlayerId: null,
         eventType: "RED_CARD",
         xg: 0,
         description: `Expulsão por segundo amarelo para ${player.name}`,
        };
        minuteEvents.push(redCardEvent);
        events.push(redCardEvent);
       } else {
        const event: KernelShotEvent = {
         minute,
         clubId: incident.team.clubId,
         playerId: player.id,
         secondaryPlayerId: null,
         eventType: "YELLOW_CARD",
         xg: 0,
         description: `Cartão amarelo para ${player.name}`,
        };
        minuteEvents.push(event);
        events.push(event);
       }
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
       const substitutionsUsed=substitutionsByClub.get(incident.team.clubId)??0;
       const substitute=substitutionsUsed<3
        ? incident.team.lineup.find(player=>!player.isStarting&&player.role!=="GK"&&!playersWhoHavePlayed.has(player.id))
        : undefined;
       injured.isStarting=false;
       if(substitute) {
        substitute.role=injured.role;substitute.slot=injured.slot;substitute.isStarting=true;
        const subEvent:KernelShotEvent={minute,clubId:incident.team.clubId,playerId:injured.id,secondaryPlayerId:substitute.id,eventType:"SUBSTITUTION",xg:0,description:`Substituição por lesão: ${injured.name} sai, ${substitute.name} entra`};
        minuteEvents.push(subEvent);events.push(subEvent);
        playersWhoHavePlayed.add(substitute.id);
        substitutionsByClub.set(incident.team.clubId,substitutionsUsed+1);
       }
       refreshTeamStrength(incident.team);
      }
     }
     const substitutionsUsed=substitutionsByClub.get(incident.team.clubId)??0;
     if(minute>=60&&substitutionsUsed<3&&incident.random()<MATCH_EVENT_PROBABILITIES.substitutionAttemptPerTeamMinuteAfter60) {
      const activeNow=incident.team.lineup.filter(player=>player.isStarting&&player.role!=="GK");
      const bench=incident.team.lineup.filter(player=>!player.isStarting&&player.role!=="GK"&&!playersWhoHavePlayed.has(player.id));
      if(activeNow.length&&bench.length) {
       const outgoing=activeNow[Math.floor(incident.random()*activeNow.length)]!;
       const incoming=bench[Math.floor(incident.random()*bench.length)]!;
       outgoing.isStarting=false;incoming.isStarting=true;incoming.role=outgoing.role;incoming.slot=outgoing.slot;playersWhoHavePlayed.add(incoming.id);
       refreshTeamStrength(incident.team);
       const event:KernelShotEvent={minute,clubId:incident.team.clubId,playerId:outgoing.id,secondaryPlayerId:incoming.id,eventType:"SUBSTITUTION",xg:0,description:`Substituição tática: ${outgoing.name} sai, ${incoming.name} entra`};
       minuteEvents.push(event);events.push(event);
       substitutionsByClub.set(incident.team.clubId,(substitutionsByClub.get(incident.team.clubId)??0)+1);
      }
     }
    }
    const gameActions = [
     ...resolveTeamGameActions(home, away, gameState.home, gameState.away, minute, homeGameRandom),
     ...resolveTeamGameActions(away, home, gameState.away, gameState.home, minute, awayGameRandom),
    ];
    const homeBasePressure=teamPressure(home,homeRandom);
    const awayBasePressure=teamPressure(away,awayRandom);
    for(const side of [
      {team:home,opponent:away,isHome:true,pressure:gameState.home.momentum,opponentPressure:gameState.away.momentum,random:homeRandom,opponentErrorRandom:awayErrorRandom},
      {team:away,opponent:home,isHome:false,pressure:gameState.away.momentum,opponentPressure:gameState.home.momentum,random:awayRandom,opponentErrorRandom:homeErrorRandom},
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
    const previousGameState = gameState;
    gameState = advanceMatchGameState(
     gameState,
     home,
     away,
     homeBasePressure,
     awayBasePressure,
     minuteEvents,
     minute,
     gameActions,
    );
    const momentumTrace: MomentumMinuteTrace | undefined = options.collectMomentumTrace
      ? (() => {
          const eventImpacts = minuteEvents.map((event, eventIndex) => ({
            eventIndex,
            eventType: event.eventType,
            clubId: event.clubId,
            xg: event.xg,
            appliedThreatImpact: event.eventType === "CHANCE"
              ? 7
              : ["GOAL", "SAVE", "MISS"].includes(event.eventType) ? event.xg * 90 : 0,
            description: event.description,
          }));
          const actionImpact = (clubId: number) => gameActions
            .filter(action => action.clubId === clubId)
            .reduce((total, action) => total + ({
              PROGRESSION: 1,
              FINAL_THIRD_ENTRY: 4,
              BOX_ENTRY: 8,
              COUNTER_ATTACK: 6,
            }[action.type] ?? 0), 0);
          const eventImpact = (clubId: number) => eventImpacts
            .filter(event => event.clubId === clubId)
            .reduce((total, event) => total + event.appliedThreatImpact, 0);
          const homeTrace = {
            clubId: home.clubId,
            previousMomentum: previousGameState.home.momentum,
            structuralPressure: homeBasePressure,
            territorialControl: gameState.home.territorialControl,
            offensiveThreat: gameState.home.offensiveThreat,
            defensiveStability: gameState.home.defensiveStability,
            intensity: gameState.home.intensity,
            physicalCondition: gameState.home.physicalCondition,
            finalMomentum: gameState.home.momentum,
            eventThreatImpact: eventImpact(home.clubId),
            actionThreatImpact: actionImpact(home.clubId),
          };
          const awayTrace = {
            clubId: away.clubId,
            previousMomentum: previousGameState.away.momentum,
            structuralPressure: awayBasePressure,
            territorialControl: gameState.away.territorialControl,
            offensiveThreat: gameState.away.offensiveThreat,
            defensiveStability: gameState.away.defensiveStability,
            intensity: gameState.away.intensity,
            physicalCondition: gameState.away.physicalCondition,
            finalMomentum: gameState.away.momentum,
            eventThreatImpact: eventImpact(away.clubId),
            actionThreatImpact: actionImpact(away.clubId),
          };
          const difference = homeTrace.finalMomentum - awayTrace.finalMomentum;
          const previousDifference = previousGameState.home.momentum - previousGameState.away.momentum;
          const dominance = Math.abs(difference) < 0.5 ? "BALANCED" as const : difference > 0 ? "HOME" as const : "AWAY" as const;
          const previousDominance = Math.abs(previousDifference) < 0.5 ? "BALANCED" : previousDifference > 0 ? "HOME" : "AWAY";
          return {
            minute,
            home: homeTrace,
            away: awayTrace,
            events: eventImpacts,
            dominance,
            dominanceChanged: dominance !== previousDominance && dominance !== "BALANCED" && previousDominance !== "BALANCED",
          };
        })()
      : undefined;
    minutes.push({
     minute,
     ...(momentumTrace ? { momentumTrace } : {}),
     homePressure:gameState.home.momentum,
     awayPressure:gameState.away.momentum,
     homeBasePressure,
     awayBasePressure,
     homeState: { ...gameState.home },
     awayState: { ...gameState.away },
     homeScore:hs,
     awayScore:as,
     events:minuteEvents,
    });
   }
   const timeline: KernelTimeline = {
    events,
    minutes,
    result: {
     homeScore: hs,
     awayScore: as,
     homeShots: hShots,
     awayShots: aShots,
     homeShotsOnTarget: hOn,
     awayShotsOnTarget: aOn,
     homeXg: hxg,
     awayXg: axg,
     homeFouls: countEvents(events, home.clubId, "FOUL"),
     awayFouls: countEvents(events, away.clubId, "FOUL"),
     homeYellowCards: countEvents(events, home.clubId, "YELLOW_CARD"),
     awayYellowCards: countEvents(events, away.clubId, "YELLOW_CARD"),
     homeRedCards: countEvents(events, home.clubId, "RED_CARD"),
     awayRedCards: countEvents(events, away.clubId, "RED_CARD"),
     homeSubstitutions: countEvents(events, home.clubId, "SUBSTITUTION"),
     awaySubstitutions: countEvents(events, away.clubId, "SUBSTITUTION"),
     homeInjuries: countEvents(events, home.clubId, "INJURY"),
     awayInjuries: countEvents(events, away.clubId, "INJURY"),
    },
   };
   validateMatchTimeline(timeline, home.clubId, away.clubId);
   return timeline;
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

function validateTeamForSimulation(team: Team): void {
  const starters = team.lineup.filter(player => player.isStarting);
  const playerIds = team.lineup.map(player => player.id);
  const goalkeeperSlots = starters.filter(player => player.role === "GK");
  if (starters.length !== 11) {
    throw new Error(`Club ${team.clubId} must have exactly eleven starting players.`);
  }
  if (new Set(playerIds).size !== playerIds.length) {
    throw new Error(`Club ${team.clubId} has duplicate players in its match lineup.`);
  }
  if (goalkeeperSlots.length !== 1 || goalkeeperSlots[0]?.goalkeeper !== 1) {
    throw new Error(`Club ${team.clubId} must field exactly one goalkeeper in the goalkeeper role.`);
  }
}

export function validateMatchTimeline(
  timeline: KernelTimeline,
  homeClubId: number,
  awayClubId: number,
): void {
  if (timeline.minutes.length !== 90) {
    throw new Error("A regulation-time timeline must contain exactly 90 minutes.");
  }

  const flattenedEvents: KernelShotEvent[] = [];
  let homeScore = 0;
  let awayScore = 0;
  let homeShots = 0;
  let awayShots = 0;
  let homeShotsOnTarget = 0;
  let awayShotsOnTarget = 0;
  let homeXg = 0;
  let awayXg = 0;

  for (let index = 0; index < timeline.minutes.length; index += 1) {
    const minute = timeline.minutes[index]!;
    if (minute.minute !== index + 1) {
      throw new Error("Match timeline minutes must be contiguous from 1 to 90.");
    }
    if (
      !Number.isFinite(minute.homePressure) ||
      !Number.isFinite(minute.awayPressure) ||
      minute.homePressure < 0 ||
      minute.homePressure > 100 ||
      minute.awayPressure < 0 ||
      minute.awayPressure > 100 ||
      !Number.isFinite(minute.homeBasePressure) ||
      !Number.isFinite(minute.awayBasePressure) ||
      minute.homeBasePressure < 0 ||
      minute.homeBasePressure > 100 ||
      minute.awayBasePressure < 0 ||
      minute.awayBasePressure > 100
    ) {
      throw new Error(`Minute ${minute.minute} contains invalid pressure values.`);
    }

    for (const event of minute.events) {
      if (event.minute !== minute.minute) {
        throw new Error("Match event minute does not match its containing timeline minute.");
      }
      if (event.clubId !== homeClubId && event.clubId !== awayClubId) {
        throw new Error("Match event references a club outside the fixture.");
      }
      if (!Number.isFinite(event.xg) || event.xg < 0 || event.xg > 1) {
        throw new Error("Match event xG must be a finite value between zero and one.");
      }
      flattenedEvents.push(event);

      const isHome = event.clubId === homeClubId;
      const isShot = event.eventType === "GOAL" || event.eventType === "SAVE" || event.eventType === "MISS";
      const isOnTarget = event.eventType === "GOAL" || event.eventType === "SAVE";

      if (event.eventType === "GOAL") {
        if (isHome) homeScore += 1;
        else awayScore += 1;
      }
      if (isShot) {
        if (isHome) {
          homeShots += 1;
          homeXg += event.xg;
          if (isOnTarget) homeShotsOnTarget += 1;
        } else {
          awayShots += 1;
          awayXg += event.xg;
          if (isOnTarget) awayShotsOnTarget += 1;
        }
      }
    }

    if (minute.homeScore !== homeScore || minute.awayScore !== awayScore) {
      throw new Error(`Minute ${minute.minute} score does not match its goal events.`);
    }
  }

  if (flattenedEvents.length !== timeline.events.length ||
      flattenedEvents.some((event, index) => event !== timeline.events[index])) {
    throw new Error("Timeline event stream does not match the minute event collections.");
  }

  const result = timeline.result;
  if (
    result.homeScore !== homeScore ||
    result.awayScore !== awayScore ||
    result.homeShots !== homeShots ||
    result.awayShots !== awayShots ||
    result.homeShotsOnTarget !== homeShotsOnTarget ||
    result.awayShotsOnTarget !== awayShotsOnTarget ||
    Math.abs(result.homeXg - homeXg) > 1e-9 ||
    Math.abs(result.awayXg - awayXg) > 1e-9 ||
    result.homeFouls !== countEvents(timeline.events, homeClubId, "FOUL") ||
    result.awayFouls !== countEvents(timeline.events, awayClubId, "FOUL") ||
    result.homeYellowCards !== countEvents(timeline.events, homeClubId, "YELLOW_CARD") ||
    result.awayYellowCards !== countEvents(timeline.events, awayClubId, "YELLOW_CARD") ||
    result.homeRedCards !== countEvents(timeline.events, homeClubId, "RED_CARD") ||
    result.awayRedCards !== countEvents(timeline.events, awayClubId, "RED_CARD") ||
    result.homeSubstitutions !== countEvents(timeline.events, homeClubId, "SUBSTITUTION") ||
    result.awaySubstitutions !== countEvents(timeline.events, awayClubId, "SUBSTITUTION") ||
    result.homeInjuries !== countEvents(timeline.events, homeClubId, "INJURY") ||
    result.awayInjuries !== countEvents(timeline.events, awayClubId, "INJURY")
  ) {
    throw new Error("Match summary does not match the generated event stream.");
  }
}


function countEvents(
  events: KernelShotEvent[],
  clubId: number,
  eventType: KernelShotEvent["eventType"],
): number {
  return events.filter(event => event.clubId === clubId && event.eventType === eventType).length;
}
