export const FIXTURE_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "POSTPONED",
  "CANCELLED",
] as const;

export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

export const MATCH_MENTALITIES = [
  { value: "VERY_DEFENSIVE", label: "Very defensive", description: "Protect space and reduce attacking commitment." },
  { value: "DEFENSIVE", label: "Defensive", description: "Prioritise shape while keeping selective attacking outlets." },
  { value: "BALANCED", label: "Balanced", description: "Keep a neutral balance between risk and control." },
  { value: "ATTACKING", label: "Attacking", description: "Commit more players forward and accept additional exposure." },
  { value: "VERY_ATTACKING", label: "Very attacking", description: "Maximise attacking intent while leaving more space to defend." },
] as const;

export type MatchMentality = (typeof MATCH_MENTALITIES)[number]["value"];

export const MATCH_TACTICAL_INSTRUCTIONS = [
  { key: "pressing", label: "Pressing", min: 0, max: 100, step: 5, description: "How aggressively the team tries to recover possession.", tradeoff: "Higher pressing creates more pressure but increases physical load." },
  { key: "tempo", label: "Tempo", min: 0, max: 100, step: 5, description: "How quickly the team tries to move the ball and progress.", tradeoff: "Higher tempo increases attacking activity but consumes more energy." },
  { key: "defensive_line", label: "Defensive line", min: 0, max: 100, step: 5, description: "How high the defensive block is positioned.", tradeoff: "A higher line supports territorial pressure but gives counter-attacks more space." },
  { key: "width", label: "Width", min: 0, max: 100, step: 5, description: "How much the team stretches play across the pitch.", tradeoff: "Width has a modest effect on shot creation and chance quality; it is not a direct strength bonus." },
  { key: "passing_directness", label: "Passing directness", min: 0, max: 100, step: 5, description: "How quickly passes try to move the ball towards the final third.", tradeoff: "Direct passing helps progression but does not guarantee better-quality chances." },
  { key: "counter_attack", label: "Counter attack", min: 0, max: 1, step: 1, description: "Whether the team looks to break quickly after the opponent advances.", tradeoff: "Only creates a benefit when a counter-attack opportunity actually occurs." },
] as const;

export type MatchInstructionKey = (typeof MATCH_TACTICAL_INSTRUCTIONS)[number]["key"];

export const FIXTURE_STATUS_TRANSITIONS: Readonly<
  Record<FixtureStatus, readonly FixtureStatus[]>
> = {
  SCHEDULED: ["IN_PROGRESS", "POSTPONED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  POSTPONED: ["SCHEDULED", "CANCELLED"],
  CANCELLED: [],
};

export function canTransitionFixtureStatus(
  current: FixtureStatus,
  next: FixtureStatus,
): boolean {
  return FIXTURE_STATUS_TRANSITIONS[current].includes(next);
}

/**
 * Playback is a presentation/session concern, not a persisted fixture status.
 * Pausing playback must not change fixture.status from IN_PROGRESS.
 */
export type MatchPlaybackStatus = "IDLE" | "PLAYING" | "PAUSED" | "FINISHED";

export type MatchEventType =
  | "KICK_OFF"
  | "CHANCE"
  | "SHOT"
  | "SHOT_ON_TARGET"
  | "GOAL"
  | "OWN_GOAL"
  | "SAVE"
  | "MISS"
  | "BLOCK"
  | "CORNER"
  | "FOUL"
  | "YELLOW_CARD"
  | "RED_CARD"
  | "OFFSIDE"
  | "SUBSTITUTION"
  | "TACTIC_CHANGE"
  | "INJURY"
  | "PENALTY"
  | "PENALTY_GOAL"
  | "PENALTY_MISS"
  | "HALF_TIME"
  | "FULL_TIME";

export type FixtureId = number;
export type ClubId = number;

export interface MatchScoreDto {
  home: number;
  away: number;
  homePenalties: number | null;
  awayPenalties: number | null;
}

export interface MatchEventDto {
  id: number;
  fixtureId: number;
  minute: number;
  addedTime: number;
  type: MatchEventType;
  clubId: number | null;
  playerId: number | null;
  secondaryPlayerId: number | null;
  xg: number | null;
  description: string | null;
}

export interface MatchMomentumTeamStateDto {
  territorialControl: number;
  offensiveThreat: number;
  defensiveStability: number;
  intensity: number;
  physicalCondition: number;
  momentum: number;
}

export interface MatchMomentumEventImpactDto {
  eventIndex: number;
  eventType: string;
  clubId: number;
  xg: number;
  appliedThreatImpact: number;
  description: string;
}

export interface MatchMomentumTeamTraceDto {
  clubId: number;
  previousMomentum: number;
  structuralPressure: number;
  territorialControl: number;
  offensiveThreat: number;
  defensiveStability: number;
  intensity: number;
  physicalCondition: number;
  finalMomentum: number;
  eventThreatImpact: number;
  actionThreatImpact: number;
}

export interface MatchMomentumTraceDto {
  minute: number;
  home: MatchMomentumTeamTraceDto;
  away: MatchMomentumTeamTraceDto;
  events: MatchMomentumEventImpactDto[];
  dominance: "HOME" | "AWAY" | "BALANCED";
  dominanceChanged: boolean;
}

export interface MatchMomentumPointDto {
  minute: number;
  homePressure: number;
  awayPressure: number;
  homeState: MatchMomentumTeamStateDto;
  awayState: MatchMomentumTeamStateDto;
  debugTrace?: MatchMomentumTraceDto;
  homeScore: number;
  awayScore: number;
}

export interface MatchTeamStatisticsDto {
  shots: number;
  shotsOnTarget: number;
  goals: number;
  expectedGoals: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  substitutions: number;
  injuries: number;
}

export interface MatchStatisticsDto {
  home: MatchTeamStatisticsDto;
  away: MatchTeamStatisticsDto;
}

export interface MatchLineupPlayerDto {
  playerId: number;
  name: string;
  position: string;
  slot: number;
  isStarting: boolean;
  energy: number;
  morale: number;
  sharpness: number;
}

export interface MatchTacticDto {
  formationId: number;
  formation: string;
  mentality: MatchMentality;
  pressing: number;
  tempo: number;
  defensiveLine: number;
  width: number;
  passingDirectness: number;
  counterAttack: boolean;
}

export interface MatchTeamDto {
  clubId: number;
  name: string;
  isHome: boolean;
  tactic: MatchTacticDto;
  lineup: MatchLineupPlayerDto[];
}

export interface MatchFixtureDto {
  id: FixtureId;
  competition: string;
  stage: string;
  round: string;
  scheduledAt: string | null;
  status: FixtureStatus;
  currentMinute: number;
  home: { clubId: number; name: string };
  away: { clubId: number; name: string };
  score: MatchScoreDto;
}

export interface MatchHistoryTacticSnapshotDto {
  clubId: number;
  clubName: string;
  tactic: {
    formation_id: number;
    formation_name: string;
    mentality: MatchMentality;
    pressing: number;
    tempo: number;
    defensive_line: number;
    width: number;
    passing_directness: number;
    counter_attack: number;
  };
  context: Record<string, unknown> | null;
}

export interface MatchHistorySnapshotDto {
  engineVersion: string;
  randomSeed: number;
  completedAt: string;
  isLegacy: boolean;
  homeTactics: MatchHistoryTacticSnapshotDto;
  awayTactics: MatchHistoryTacticSnapshotDto;
}
export interface MatchPlayerMatchStatsDto {
  playerId: number;
  clubId: number;
  energy: number;
  rating: number;
  minutesPlayed: number;
  goals: number;
  assists: number;
  yellowCards: number;
  redCard: boolean;
  substitutedOut: boolean;
}
export interface MatchCenterResponse {
  fixture: MatchFixtureDto;
  managedClubId: ClubId;
  formations: Array<{ id: number; name: string }>;
  playbackStatus: MatchPlaybackStatus;
  teams: [MatchTeamDto, MatchTeamDto];
  statistics: MatchStatisticsDto;
  playerStats: MatchPlayerMatchStatsDto[];
  events: MatchEventDto[];
  momentum: MatchMomentumPointDto[];
  history?: MatchHistorySnapshotDto;
}

export interface PrepareMatchRequest {
  clubId: number;
  starterIds: number[];
  benchIds: number[];
}

export type MatchTacticalChangeRequest =
  | {
      minute: number;
      type: "MENTALITY";
      mentality: MatchMentality;
    }
  | {
      minute: number;
      type: "INSTRUCTION";
      key: MatchInstructionKey;
      value: number;
    }
  | {
      minute: number;
      type: "SUBSTITUTION";
      playerOutId: number;
      playerInId: number;
    }
  | {
      minute: number;
      type: "FORMATION";
      formationId: number;
    };

export interface AdvanceMatchRequest {
  /** Inclusive simulation minute to reach; valid range is 1..90 for the current engine. */
  throughMinute: number;
}

export interface MatchSimulationCheckpointDto {
  fixtureId: FixtureId;
  engineVersion: string;
  simulationMinute: number;
  completed: boolean;
  updatedAt: string;
}

export interface MatchPreparationResponse {
  fixture: MatchFixtureDto;
  managedClubId: number;
  homeLineup: MatchLineupPlayerDto[];
  awayLineup: MatchLineupPlayerDto[];
  managedClubIsHome: boolean;
}

export interface SaveMatchLineupRequest {
  starterIds: number[];
  benchIds: number[];
}

export interface MatchTacticalChangeResponse {
  changeId: number;
  fixtureId: FixtureId;
  scheduledMinute: number;
  type: MatchTacticalChangeRequest["type"];
}
