import {
    HOME_SHOT_CHANCE_BONUS,
} from "./constants.js";
import {
    clamp,
} from "./mathUtils.js";
import type {
    Tactic,
    Team,
} from "../types/match-engine.types.js";


const DEFAULT_CONTEXT = {
    weather: "CLEAR",
    temperatureC: 20,
    pitchCondition: 70,
    restHours: 168,
    travelKm: 0,
    travelHours: 0,
} as const;


export function mentalityShotModifier(
    value: string
): number {
    return {
        VERY_DEFENSIVE: -0.018,
        DEFENSIVE: -0.009,
        BALANCED: 0,
        ATTACKING: 0.009,
        VERY_ATTACKING: 0.018,
    }[value] ?? 0;
}


export function teamPressure(
    team: Team,
    random: () => number
): number {
    const mentality = {
        VERY_DEFENSIVE: -5,
        DEFENSIVE: -2,
        BALANCED: 0,
        ATTACKING: 3,
        VERY_ATTACKING: 5,
    }[team.tactic.mentality] ?? 0;


    const context =
        team.context ??
        DEFAULT_CONTEXT;


    const fatigue = Math.min(
        5,
        Math.max(
            0,
            72 - context.restHours
        ) / 24 * 1.4 +
        context.travelKm / 500 * 1.1
    );


    return clamp(
        team.attacking * 0.43 +
        team.tactic.pressing * 0.16 +
        team.tactic.tempo * 0.10 +
        team.tactic.defensive_line * 0.04 +
        mentality -
        fatigue +
        random() * 8,
        0,
        100
    );
}


export function shotCreationProbability(
    team: Team,
    opponent: Team,
    isHome: boolean,
    pressure: number,
    opponentPressure: number
): number {
    const tactic = team.tactic;
    const ctx = team.context ?? { weather: "CLEAR", temperatureC: 20, pitchCondition: 70, restHours: 168, travelKm: 0, travelHours: 0 };
    const fatigue = Math.min(.035, Math.max(0, 72 - ctx.restHours) * .00020 + ctx.travelKm / 500 * .004);
    const weatherPenalty = ctx.weather === "HEAVY_RAIN" ? .012 : ctx.weather === "RAIN" ? .006 : ctx.weather === "WIND" ? (tactic.passing_directness < 60 ? .008 : .003) : ctx.weather === "HEAT" ? .004 : 0;
    const pitchPenalty = Math.max(0, 70 - ctx.pitchCondition) * .00012;
    return clamp(.095 + (team.attacking - 50) * .00135 + (50 - opponent.defending) * .00060 +
        mentalityShotModifier(tactic.mentality) + (tactic.pressing - 50) * .00012 +
        (tactic.tempo - 50) * .00012 + (pressure - opponentPressure) * .00012 +
        (tactic.passing_directness - 50) * .000055 + (tactic.width - 50) * .000025 +
        (tactic.counter_attack ? .004 : 0) + (isHome ? HOME_SHOT_CHANCE_BONUS : 0) - fatigue - weatherPenalty - pitchPenalty, .05, .205);
}


export function sampleChanceQuality(
    team: Team,
    tactic: Tactic,
    finishing: number,
    random: () => number
): number {
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


export function onTargetProbability(
    xg: number
): number {
    return clamp(
        0.29 + xg * 0.5,
        0.30,
        0.48
    );
}


export function goalConversionProbability(
    xg: number,
    onTargetChance: number,
    keeperSkill: number
): number {
    const keeperFactor = clamp(
        1 + (50 - keeperSkill) * 0.0075,
        0.66,
        1.34
    );

    return clamp(
        (xg / onTargetChance) * keeperFactor,
        0.015,
        0.82
    );
}