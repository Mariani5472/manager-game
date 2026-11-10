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

export type GameActionType =
  "PROGRESSION" | "FINAL_THIRD_ENTRY" | "BOX_ENTRY" | "COUNTER_ATTACK";

export interface GameAction {
  minute: number;
  clubId: number;
  type: GameActionType;
}
