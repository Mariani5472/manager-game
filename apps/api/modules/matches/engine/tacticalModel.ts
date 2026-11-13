import type { Tactic, TacticMentality } from "../types/match-engine.types.js";
import { clamp } from "./mathUtils.js";

export interface MentalityEffects {
  pressure: number;
  territory: number;
  shotCreation: number;
}

const MENTALITY_EFFECTS: Record<TacticMentality, MentalityEffects> = {
  VERY_DEFENSIVE: { pressure: -5, territory: -5, shotCreation: -0.018 },
  DEFENSIVE: { pressure: -2, territory: -2, shotCreation: -0.009 },
  BALANCED: { pressure: 0, territory: 0, shotCreation: 0 },
  ATTACKING: { pressure: 3, territory: 3, shotCreation: 0.009 },
  VERY_ATTACKING: { pressure: 5, territory: 5, shotCreation: 0.018 },
};

export function getMentalityEffects(mentality: string): MentalityEffects {
  return (
    MENTALITY_EFFECTS[mentality as TacticMentality] ??
    MENTALITY_EFFECTS.BALANCED
  );
}

export function getTacticalProgressionModifier(tactic: Tactic): number {
  return (
    (tactic.pressing - 50) * 0.0009 +
    (tactic.tempo - 50) * 0.0006 +
    (tactic.defensive_line - 50) * 0.0002
  );
}

export function getTacticalFinalThirdModifier(tactic: Tactic): number {
  return (
    (tactic.passing_directness - 50) * 0.0005 +
    (tactic.width - 50) * 0.0001
  );
}

export function getTacticalShotCreationModifier(
  tactic: Tactic,
  isCounterAttack: boolean,
): number {
  return (
    (tactic.pressing - 50) * 0.00012 +
    (tactic.tempo - 50) * 0.00012 +
    (tactic.passing_directness - 50) * 0.000055 +
    (tactic.width - 50) * 0.000025 +
    (isCounterAttack && tactic.counter_attack === 1 ? 0.004 : 0)
  );
}

export function getTacticalChanceQualityModifier(
  tactic: Tactic,
  isCounterAttack: boolean,
): number {
  return (
    (tactic.tempo - 50) * 0.00004 +
    (tactic.passing_directness - 50) * 0.00006 +
    (tactic.width - 50) * 0.000035 +
    (isCounterAttack && tactic.counter_attack === 1 ? 0.012 : 0)
  );
}

export function getTacticalPhysicalLoadPerMinute(tactic: Tactic): number {
  return 0.025 + tactic.pressing * 0.0006 + tactic.tempo * 0.0003;
}

export function getCounterAttackOpportunityChance(
  tactic: Tactic,
  opponent: Tactic,
  attacking: number,
  opponentDefending: number,
): number {
  if (!tactic.counter_attack) return 0;

  // A high opposing defensive line leaves more space to attack after a turnover.
  const exposedSpace = (opponent.defensive_line - 50) * 0.001;
  return clamp(
    0.08 + (attacking - opponentDefending) * 0.001 + exposedSpace,
    0.04,
    0.22,
  );
}
