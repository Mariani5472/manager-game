import { clamp } from "../mathUtils.js";
import type { KernelShotEvent, Team } from "../../types/match-engine.types.js";
import type { MatchGameState, TeamGameState } from "./gameState.types.js";

const TERRITORY_MEMORY = 0.78;
const THREAT_MEMORY = 0.72;
const MOMENTUM_MEMORY = 0.65;

function activePlayerRatio(team: Team): number {
  return team.lineup.filter(player => player.isStarting).length / 11;
}

function initialTeamState(team: Team): TeamGameState {
  const intensity = (team.tactic.pressing + team.tactic.tempo) / 2;
  const physicalCondition = clamp(team.energy, 0, 100);
  const territorialControl = 50;
  const offensiveThreat = 25;
  const defensiveStability = clamp(team.defending, 0, 100);
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

function calculateEventThreat(events: KernelShotEvent[], clubId: number): number {
  return events.reduce((impact, event) => {
    if (event.clubId !== clubId) return impact;

    switch (event.eventType) {
      case "GOAL":
      case "SAVE":
      case "MISS":
        // xG represents chance quality; the scoreline itself is deliberately ignored.
        return impact + event.xg * 65;
      case "CHANCE":
        return impact + 3;
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
  minute: number,
): TeamGameState {
  const activeRatio = activePlayerRatio(team);
  const opponentActiveRatio = activePlayerRatio(opponent);
  const opponentDefensiveStrength = opponent.defending * opponentActiveRatio;
  const mentalityModifier = {
    VERY_DEFENSIVE: -5,
    DEFENSIVE: -2,
    BALANCED: 0,
    ATTACKING: 3,
    VERY_ATTACKING: 5,
  }[team.tactic.mentality] ?? 0;

  const territorialTarget = clamp(
    50 +
      (basePressure - 50) * 0.55 +
      (team.attacking - opponentDefensiveStrength) * 0.18 +
      (team.tactic.pressing - 50) * 0.1 +
      (team.tactic.tempo - 50) * 0.08 +
      mentalityModifier,
    0,
    100,
  );
  const territorialControl =
    previous.territorialControl * TERRITORY_MEMORY +
    territorialTarget * (1 - TERRITORY_MEMORY);

  const passiveThreat = Math.max(0, territorialControl - 45) * 0.12;
  const eventThreat = calculateEventThreat(minuteEvents, team.clubId);
  const offensiveThreat = clamp(
    previous.offensiveThreat * THREAT_MEMORY + passiveThreat + eventThreat,
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
  const physicalLoadPerMinute =
    0.025 + team.tactic.pressing * 0.0006 + team.tactic.tempo * 0.0003;
  const physicalCondition = clamp(
    team.energy - minute * physicalLoadPerMinute,
    0,
    100,
  );

  const defensiveStability = clamp(
    team.defending * activeRatio,
    0,
    100,
  );

  const rawMomentum = clamp(
    territorialControl * 0.4 +
      offensiveThreat * 0.4 +
      intensity * 0.1 +
      physicalCondition * 0.1,
    0,
    100,
  );
  const momentum = clamp(
    previous.momentum * MOMENTUM_MEMORY +
      rawMomentum * (1 - MOMENTUM_MEMORY),
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
): MatchGameState {
  return {
    home: calculateTeamState(
      home,
      away,
      previous.home,
      homeBasePressure,
      minuteEvents,
      minute,
    ),
    away: calculateTeamState(
      away,
      home,
      previous.away,
      awayBasePressure,
      minuteEvents,
      minute,
    ),
  };
}
