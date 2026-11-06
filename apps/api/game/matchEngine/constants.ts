import type {
  MatchEventProbabilities,
} from "./types.js";


export const HOME_SHOT_CHANCE_BONUS = 0.004;


export const MATCH_EVENT_PROBABILITIES:
  MatchEventProbabilities = {
    foulPerTeamMinute: 0.12,
    yellowCardPerTeamMinute: 0.022,
    redCardPerTeamMinute: 0.0005,
    injuryPerTeamMinute: 0.0015,
    defensiveErrorPerDefendingTeamMinute: 0.0015,
    substitutionAttemptPerTeamMinuteAfter60: 0.035,
  };


export const COMPATIBLE_POSITIONS:
  Record<string, string[]> = {
    GK: ["GK"],
    CB: ["CB"],
    LB: ["LB", "LWB", "RB"],
    RB: ["RB", "RWB", "LB"],
    LWB: ["LWB", "LB", "RWB"],
    RWB: ["RWB", "RB", "LWB"],
    DM: ["DM", "CM"],
    CM: ["CM", "DM", "AM"],
    AM: ["AM", "CM", "ST"],
    LW: ["LW", "LM", "RW", "RM"],
    RW: ["RW", "RM", "LW", "LM"],
    LM: ["LM", "LW", "RM", "RW"],
    RM: ["RM", "RW", "LM", "LW"],
    ST: ["ST", "AM"],
  };


export const VALID_MENTALITIES = [
  "VERY_DEFENSIVE",
  "DEFENSIVE",
  "BALANCED",
  "ATTACKING",
  "VERY_ATTACKING",
] as const;


export const VALID_ROLES = [
  "GK",
  "CB",
  "LB",
  "RB",
  "LWB",
  "RWB",
  "DM",
  "CM",
  "AM",
  "LW",
  "RW",
  "LM",
  "RM",
  "ST",
] as const;


export const TACTICAL_INSTRUCTION_RANGES:
  Record<string, [number, number]> = {
    pressing: [0, 100],
    tempo: [0, 100],
    defensive_line: [0, 100],
    width: [0, 100],
    passing_directness: [0, 100],
    counter_attack: [0, 1],
  };