import type { MatchContext } from "../matchContext.js";


export interface MatchSummary {
  fixtureId: number;
  homeClubId: number;
  awayClubId: number;
  homeScore: number;
  awayScore: number;
  events: number;
  minutes: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeXg: number;
  awayXg: number;
}


export interface FixtureRow {
  id: number;
  home_club_id: number;
  away_club_id: number;
  random_seed: number | null;
  status: string;
}


export interface Player {
  id: number;
  name: string;
  goalkeeper: number;
  energy: number;
  morale: number;
  sharpness: number;
  pace: number;
  stamina: number;
  strength: number;
  positioning: number;
  decisions: number;
  composure: number;
  teamwork: number;
  work_rate: number;
  passing: number;
  vision: number;
  crossing: number;
  dribbling: number;
  finishing: number;
  long_shots: number;
  heading: number;
  tackling: number;
  marking: number;
  aggression: number;
  concentration: number;
  reflexes: number;
  handling: number;
  aerial_reach: number;
}


export interface Tactic {
  formation_id: number;
  mentality: string;
  pressing: number;
  tempo: number;
  defensive_line: number;
  width: number;
  passing_directness: number;
  counter_attack: number;
}


export interface MatchPlayer extends Player {
  role: string;
  slot: number;
  isStarting: boolean;
  positionRating: number;
}


export interface Team {
  clubId: number;
  reputation: number;
  tactic: Tactic;
  lineup: MatchPlayer[];
  attacking: number;
  defending: number;
  goalkeeping: number;
  energy: number;
  fitness: number;
  context?: MatchContext;
}


export interface SimulatedMatchResult {
  homeScore: number;
  awayScore: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeXg: number;
  awayXg: number;
}


export interface MonteCarloReport {
  simulations: number;
  homeWinRate: number;
  drawRate: number;
  awayWinRate: number;
  averageHomeGoals: number;
  averageAwayGoals: number;
  averageTotalGoals: number;
  homeShotRate: number;
  awayShotRate: number;
  averageTotalShots: number;
  averageTotalShotsOnTarget: number;
  averageTotalXg: number;
  meanAbsoluteGoalDifference: number;
  goallessRate: number;
  anyTeamFivePlusGoalsRate: number;
  sixPlusTotalGoalsRate: number;
  homeWinByThreePlusRate: number;
  awayWinByThreePlusRate: number;
  maxTeamGoals: number;
  maxTotalGoals: number;
}


export type MatchEventType =
  | "GOAL"
  | "SAVE"
  | "MISS"
  | "SUBSTITUTION"
  | "TACTIC_CHANGE"
  | "CHANCE"
  | "FOUL"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "INJURY";


export interface KernelShotEvent {
  minute: number;
  clubId: number;
  playerId: number;
  secondaryPlayerId: number | null;
  eventType: MatchEventType;
  xg: number;
  description: string;
  injuryDays?: number;
}


export interface KernelMinute {
  minute: number;
  homePressure: number;
  awayPressure: number;
  homeScore: number;
  awayScore: number;
  events: KernelShotEvent[];
}


export interface TacticalChange {
  id: number;
  minute: number;
  club_id: number;
  change_type: string;
  payload: string;
}


export interface KernelTimeline {
  result: SimulatedMatchResult;
  events: KernelShotEvent[];
  minutes: KernelMinute[];
}


export interface TacticalImpactScenario {
  name: string;
  description: string;
  result: MonteCarloReport;
  homeWinRateDelta: number;
  averageHomeGoalsDelta: number;
  homeShotsDelta: number;
  averageTotalXgDelta: number;
}


export interface TacticalImpactReport {
  homeClubId: number;
  awayClubId: number;
  simulations: number;
  seed: number;
  scenarios: TacticalImpactScenario[];
}


export interface MeanConfidenceInterval {
  estimate: number;
  lower: number;
  upper: number;
  observations: number;
  confidenceLevel: number;
}


export interface BinomialConfidenceInterval {
  estimate: number;
  lower: number;
  upper: number;
  successes: number;
  trials: number;
  confidenceLevel: number;
}


export interface XgBandDiagnostic {
  band: string;
  shots: number;
  averageXg: number;
  averageXgInterval: MeanConfidenceInterval;
  onTargetRate: number;
  onTargetInterval: BinomialConfidenceInterval;
  goalRate: number;
  goalInterval: BinomialConfidenceInterval;
  saveRate: number;
  saveInterval: BinomialConfidenceInterval;
  missRate: number;
  missInterval: BinomialConfidenceInterval;
  goals: number;
  saves: number;
  misses: number;
}


export interface MatchEngineDiagnostics {
  simulations: number;
  baseline: MonteCarloReport;

  statisticalAcceptance: {
    method: "Wilson score interval";
    confidenceLevel: number;

    outcomes: {
      homeWin: BinomialConfidenceInterval;
      draw: BinomialConfidenceInterval;
      awayWin: BinomialConfidenceInterval;
    };

    outcomeRatesSum: number;
    outcomeRatesPartition: boolean;
    interpretation: string;
  };

  xgBands: XgBandDiagnostic[];

  homeAdvantage: {
    clubA: number;
    clubB: number;
    clubAWinRateAtHome: number;
    clubAWinRateAway: number;
    homeAdvantageDelta: number;
    shotChanceBonus: number;
    note: string;
  };

  strengthGap: {
    weakClubId: number;
    strongClubId: number;
    weakStrength: number;
    strongStrength: number;
    strengthDifference: number;
    hasMeaningfulGap: boolean;
    note: string;
    strongWinRate: number;
    drawRate: number;
    weakWinRate: number;
    strongAverageGoals: number;
    weakAverageGoals: number;
  };

  eventProbabilities: MatchEventProbabilities;

  persistedMatches: {
    checked: number;
    issues: string[];
    warnings: string[];
  };
}


export interface MatchEventProbabilities {
  readonly foulPerTeamMinute: number;
  readonly yellowCardPerTeamMinute: number;
  readonly redCardPerTeamMinute: number;
  readonly injuryPerTeamMinute: number;
  readonly defensiveErrorPerDefendingTeamMinute: number;
  readonly substitutionAttemptPerTeamMinuteAfter60: number;
}


export interface TacticalSensitivityScenario {
  name: string;
  changedVariable: string;
  value: string | number;
  homeWinRate: number;
  homeWinRateDelta: number;
  averageHomeGoals: number;
  averageHomeGoalsDelta: number;
  homeShotsPerMatch: number;
  homeShotsDelta: number;
  averageTotalXg: number;
  averageTotalXgDelta: number;
}


export interface TacticalSensitivityReport {
  homeClubId: number;
  awayClubId: number;
  simulations: number;
  seed: number;
  baseline: MonteCarloReport;
  scenarios: TacticalSensitivityScenario[];
}


export interface SeasonBalanceClub {
  clubId: number;
  reputation: number;
  strength: number;
  tier: string;
  averagePoints: number;
  averageGoalDifference: number;
  averageGoalsFor: number;
  averageGoalsAgainst: number;
  titleRate: number;
  topFourRate: number;
  bottomFourRate: number;
}


export interface SeasonBalanceTierSummary {
  tier: string;
  clubs: number;
  averagePoints: number;
  averageGoalDifference: number;
  averageGoalsAgainst: number;
}


export interface SeasonBalanceReport {
  seasons: number;
  matchesPerSeason: number;
  totalMatches: number;
  seedStart: number;
  favoriteWinRate: number;
  underdogWinRate: number;
  drawRate: number;
  upsetDefinition: string;
  clubs: SeasonBalanceClub[];
  tierSummary: SeasonBalanceTierSummary[];
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


export type TacticalChangeType =
  | "MENTALITY"
  | "INSTRUCTION"
  | "SUBSTITUTION"
  | "FORMATION";