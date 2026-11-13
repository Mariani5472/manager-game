import { clamp } from "../mathUtils.js";
import { getMentalityEffects, getTacticalPhysicalLoadPerMinute } from "../tacticalModel.js";
import type { KernelShotEvent, Team } from "../../types/match-engine.types.js";
import type {
  GameAction,
  MatchGameState,
  TeamGameState,
} from "./gameState.types.js";

const TERRITORY_MEMORY = 0.58;
const THREAT_MEMORY = 0.52;
const MOMENTUM_MEMORY = 0.42;

function activePlayerRatio(team: Team): number {
  return team.lineup.filter((player) => player.isStarting).length / 11;
}

function initialTeamState(team: Team): TeamGameState {
  const intensity = (team.tactic.pressing + team.tactic.tempo) / 2;
  const physicalCondition = clamp(team.energy, 0, 100);
  const territorialControl = 50;
  const offensiveThreat = 25;
  const defensiveStability = clamp(
    team.defending + getMentalityEffects(team.tactic.mentality).defensiveStability,
    0,
    100,
  );
  const momentum =
    territorialControl * 0.4 +
    offensiveThreat * 0.4 +
    intensity * 0.1 +
    physicalCondition * 0.1;

  return {
    territorialControl,
    offensiveThreat,
    defensiveStability,
    intensity,
    physicalCondition,
    momentum,
  };
}

export function createMatchGameState(home: Team, away: Team): MatchGameState {
  return {
    home: initialTeamState(home),
    away: initialTeamState(away),
  };
}

function calculateEventThreat(
  events: KernelShotEvent[],
  clubId: number,
): number {
  return events.reduce((impact, event) => {
    if (event.clubId !== clubId) return impact;

    switch (event.eventType) {
      case "GOAL":
      case "SAVE":
      case "MISS":
        // xG represents chance quality; the scoreline itself is deliberately ignored.
        return impact + event.xg * 90;
      case "CHANCE":
        return impact + 7;
      default:
        return impact;
    }
  }, 0);
}

function calculateTeamState(
  team: Team,
  opponent: Team,
  previous: TeamGameState,
  basePressure: number,
  minuteEvents: KernelShotEvent[],
  gameActions: GameAction[],
  minute: number,
): TeamGameState {
  const activeRatio = activePlayerRatio(team);
  const opponentActiveRatio = activePlayerRatio(opponent);
  const opponentDefensiveStrength = opponent.defending * opponentActiveRatio;
  const mentalityModifier = getMentalityEffects(team.tactic.mentality).territory;

  const teamActions = gameActions.filter(
    (action) => action.clubId === team.clubId,
  );
  const territorialActionImpact = teamActions.reduce((impact, action) => {
    switch (action.type) {
      case "PROGRESSION":
        return impact + 1.5;
      case "FINAL_THIRD_ENTRY":
        return impact + 4;
      case "BOX_ENTRY":
        return impact + 6;
      case "COUNTER_ATTACK":
        return impact + 5;
      default:
        return impact;
    }
  }, 0);
  const actionThreat = teamActions.reduce((impact, action) => {
    switch (action.type) {
      case "PROGRESSION":
        return impact + 1;
      case "FINAL_THIRD_ENTRY":
        return impact + 4;
      case "BOX_ENTRY":
        return impact + 8;
      case "COUNTER_ATTACK":
        return impact + 6;
      default:
        return impact;
    }
  }, 0);

  const territorialTarget = clamp(
    50 +
      (basePressure - 50) * 0.8 +
      (team.attacking - opponentDefensiveStrength) * 0.22 +
      (team.tactic.pressing - 50) * 0.08 +
      (team.tactic.tempo - 50) * 0.06 +
      (activeRatio - 1) * 25 +
      Math.min(18, territorialActionImpact) +
      mentalityModifier,
    0,
    100,
  );
  const territorialControl =
    previous.territorialControl * TERRITORY_MEMORY +
    territorialTarget * (1 - TERRITORY_MEMORY);

  const passiveThreat = Math.max(0, territorialControl - 42) * 0.24;
  const eventThreat = calculateEventThreat(minuteEvents, team.clubId);
  const offensiveThreat = clamp(
    previous.offensiveThreat * THREAT_MEMORY +
      passiveThreat +
      eventThreat +
      actionThreat,
    0,
    100,
  );

  const intensityTarget = clamp(
    team.tactic.pressing * 0.55 + team.tactic.tempo * 0.45,
    0,
    100,
  );
  const intensity = previous.intensity * 0.8 + intensityTarget * 0.2;

  // This is an in-match load estimate. Player energy persistence remains outside this P0 scope.
  const physicalLoadPerMinute = getTacticalPhysicalLoadPerMinute(team.tactic);
  const physicalCondition = clamp(
    team.energy - minute * physicalLoadPerMinute,
    0,
    100,
  );

  const defensiveStability = clamp(
    team.defending * activeRatio +
      getMentalityEffects(team.tactic.mentality).defensiveStability,
    0,
    100,
  );

  const rawMomentum = clamp(
    territorialControl * 0.3 +
      offensiveThreat * 0.5 +
      intensity * 0.1 +
      physicalCondition * 0.1,
    0,
    100,
  );
  const momentum = clamp(
    previous.momentum * MOMENTUM_MEMORY + rawMomentum * (1 - MOMENTUM_MEMORY),
    0,
    100,
  );

  return {
    territorialControl,
    offensiveThreat,
    defensiveStability,
    intensity,
    physicalCondition,
    momentum,
  };
}

export function advanceMatchGameState(
  previous: MatchGameState,
  home: Team,
  away: Team,
  homeBasePressure: number,
  awayBasePressure: number,
  minuteEvents: KernelShotEvent[],
  minute: number,
  gameActions: GameAction[] = [],
): MatchGameState {
  return {
    home: calculateTeamState(
      home,
      away,
      previous.home,
      homeBasePressure,
      minuteEvents,
      gameActions,
      minute,
    ),
    away: calculateTeamState(
      away,
      home,
      previous.away,
      awayBasePressure,
      minuteEvents,
      gameActions,
      minute,
    ),
  };
}
