import { HOME_SHOT_CHANCE_BONUS } from "./constants.js";
import { clamp } from "./mathUtils.js";
import type { Tactic, Team } from "../types/match-engine.types.js";
import {
  getMentalityEffects,
  getTacticalChanceQualityModifier,
  getTacticalShotCreationModifier,
} from "./tacticalModel.js";

const DEFAULT_CONTEXT = {
  weather: "CLEAR",
  temperatureC: 20,
  pitchCondition: 70,
  restHours: 168,
  travelKm: 0,
  travelHours: 0,
} as const;

export function mentalityShotModifier(value: string): number {
  return getMentalityEffects(value).shotCreation;
}

export function teamPressure(team: Team, random: () => number): number {
  const mentality = getMentalityEffects(team.tactic.mentality).pressure;

  const context = team.context ?? DEFAULT_CONTEXT;

  const fatigue = Math.min(
    5,
    (Math.max(0, 72 - context.restHours) / 24) * 1.4 +
      (context.travelKm / 500) * 1.1,
  );

  return clamp(
    team.attacking * 0.43 +
      team.tactic.pressing * 0.16 +
      team.tactic.tempo * 0.1 +
      team.tactic.defensive_line * 0.04 +
      mentality -
      fatigue +
      random() * 8,
    0,
    100,
  );
}

export function shotCreationProbability(
  team: Team,
  opponent: Team,
  isHome: boolean,
  pressure: number,
  opponentPressure: number,
  isCounterAttack = false,
): number {
  const tactic = team.tactic;
  const ctx = team.context ?? {
    weather: "CLEAR",
    temperatureC: 20,
    pitchCondition: 70,
    restHours: 168,
    travelKm: 0,
    travelHours: 0,
  };
  const fatigue = Math.min(
    0.035,
    Math.max(0, 72 - ctx.restHours) * 0.0002 + (ctx.travelKm / 500) * 0.004,
  );
  const weatherPenalty =
    ctx.weather === "HEAVY_RAIN"
      ? 0.012
      : ctx.weather === "RAIN"
        ? 0.006
        : ctx.weather === "WIND"
          ? tactic.passing_directness < 60
            ? 0.008
            : 0.003
          : ctx.weather === "HEAT"
            ? 0.004
            : 0;
  const pitchPenalty = Math.max(0, 70 - ctx.pitchCondition) * 0.00012;
  return clamp(
    0.095 +
      (team.attacking - 50) * 0.00135 +
      (50 - opponent.defending) * 0.0006 +
      mentalityShotModifier(tactic.mentality) +
      getTacticalShotCreationModifier(tactic, isCounterAttack) +
      (pressure - opponentPressure) * 0.00012 +
      (isHome ? HOME_SHOT_CHANCE_BONUS : 0) -
      fatigue -
      weatherPenalty -
      pitchPenalty,
    0.05,
    0.205,
  );
}

export function sampleChanceQuality(
  team: Team,
  tactic: Tactic,
  finishing: number,
  random: () => number,
  isCounterAttack = false,
): number {
  const ctx = team.context ?? {
    weather: "CLEAR",
    temperatureC: 20,
    pitchCondition: 70,
    restHours: 168,
    travelKm: 0,
    travelHours: 0,
  };
  const qualityRoll = random();
  const baseXg =
    qualityRoll < 0.56
      ? 0.035 + random() * 0.06
      : qualityRoll < 0.92
        ? 0.095 + random() * 0.075
        : 0.17 + random() * 0.15;
  return clamp(
    baseXg +
      (team.attacking - 50) * 0.00042 +
      (finishing - 50) * 0.00018 +
      getTacticalChanceQualityModifier(tactic, isCounterAttack) -
      Math.max(0, 70 - ctx.pitchCondition) * 0.00025 -
      (ctx.weather === "HEAVY_RAIN"
        ? 0.012
        : ctx.weather === "RAIN"
          ? 0.006
          : ctx.weather === "WIND"
            ? 0.004
            : 0),
    0.02,
    0.38,
  );
}

export function onTargetProbability(xg: number): number {
  return clamp(0.29 + xg * 0.5, 0.3, 0.48);
}

export function goalConversionProbability(
  xg: number,
  onTargetChance: number,
  keeperSkill: number,
): number {
  const keeperFactor = clamp(1 + (50 - keeperSkill) * 0.0075, 0.66, 1.34);

  return clamp((xg / onTargetChance) * keeperFactor, 0.015, 0.82);
}
