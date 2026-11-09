export interface TeamGameState {
  territorialControl: number;
  offensiveThreat: number;
  defensiveStability: number;
  intensity: number;
  physicalCondition: number;
  momentum: number;
}

export interface MatchGameState {
  home: TeamGameState;
  away: TeamGameState;
}
