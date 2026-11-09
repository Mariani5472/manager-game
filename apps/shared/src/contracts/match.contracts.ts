export const FIXTURE_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "POSTPONED",
  "CANCELLED",
] as const;

export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

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

export interface MatchMomentumPointDto {
  minute: number;
  homePressure: number;
  awayPressure: number;
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

export interface MatchTeamDto {
  clubId: number;
  name: string;
  isHome: boolean;
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

export interface MatchCenterResponse {
  fixture: MatchFixtureDto;
  playbackStatus: MatchPlaybackStatus;
  teams: [MatchTeamDto, MatchTeamDto];
  statistics: MatchStatisticsDto;
  events: MatchEventDto[];
  momentum: MatchMomentumPointDto[];
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
      mentality:
        | "VERY_DEFENSIVE"
        | "DEFENSIVE"
        | "BALANCED"
        | "ATTACKING"
        | "VERY_ATTACKING";
    }
  | {
      minute: number;
      type: "INSTRUCTION";
      key:
        | "pressing"
        | "tempo"
        | "defensive_line"
        | "width"
        | "passing_directness"
        | "counter_attack";
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


export type MatchMentality =
  | "VERY_DEFENSIVE"
  | "DEFENSIVE"
  | "BALANCED"
  | "ATTACKING"
  | "VERY_ATTACKING";

export type MatchInstructionKey =
  | "pressing"
  | "tempo"
  | "defensive_line"
  | "width"
  | "passing_directness"
  | "counter_attack";

export interface MatchTacticalChangeResponse {
  changeId: number;
  fixtureId: FixtureId;
  scheduledMinute: number;
  type: MatchTacticalChangeRequest["type"];
}
