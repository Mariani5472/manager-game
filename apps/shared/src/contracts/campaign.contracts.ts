import type { FixtureStatus } from "./match.contracts.js";

export type SquadStatus = "FIRST_TEAM" | "RESERVE" | "YOUTH";

export interface CampaignClubDto {
  id: number;
  name: string;
  nation: string;
  isManaged: boolean;
  reputation: number;
  city: string | null;
  stadium: string | null;
  stadiumCapacity: number | null;
}

export interface CampaignFixtureDto {
  id: number;
  competition: string;
  stage: string;
  round: string;
  scheduledAt: string | null;
  homeClub: string;
  awayClub: string;
  status: FixtureStatus;
  score: string | null;
  winnerClub: string | null;
}

export interface CampaignPlayerDto {
  id: number;
  name: string;
  shirtNumber: number | null;
  squadStatus: SquadStatus;
  positions: string[];
  energy: number;
  morale: number;
  sharpness: number;
}

export interface CampaignTacticsDto {
  formation: string;
  mentality: string;
  pressing: number;
  tempo: number;
  defensiveLine: number;
  width: number;
  passingDirectness: number;
  counterAttack: boolean;
}

export interface CampaignStandingDto {
  position: number;
  groupId: number;
  groupName: string;
  club: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  isManaged: boolean;
}

export interface CampaignCompetitionDto {
  competition: string;
  stage: string;
  seasonYear: number;
  stageStatus: "IN_PROGRESS" | "COMPLETED";
  pendingFixtures: number;
  completedFixtures: number;
  stageId: number;
  standing: CampaignStandingDto[];
}

export interface CampaignOverviewResponse {
  save: { id: string; name: string; managerName: string };
  club: CampaignClubDto;
  nextFixture: CampaignFixtureDto | null;
  recentResult: CampaignFixtureDto | null;
  competitions: CampaignCompetitionDto[];
  squadSize: number;
}

export interface CampaignCalendarResponse {
  fixtures: CampaignFixtureDto[];
}

export interface CampaignSquadResponse {
  club: CampaignClubDto;
  players: CampaignPlayerDto[];
}

export interface CampaignTeamResponse {
  club: CampaignClubDto;
  tactics: CampaignTacticsDto;
  finances: {
    balance: number;
    transferBudget: number;
    weeklyWageBudget: number;
    wageBillWeekly: number;
    squadSize: number;
  } | null;
}

export interface CampaignCompetitionDetailResponse {
  stage: { stageId: number; competition: string; stage: string; seasonYear: number; stageKind: string; stageStatus: "IN_PROGRESS" | "COMPLETED" };
  standings: Array<{ position: number; groupId: number; groupName: string; clubId: number; club: string; played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; goalDifference: number; points: number }>;
  rounds: Array<{ roundId: number; roundNumber: number; name: string; fixtureCount: number; completedCount: number; fixtures: Array<{ id: number; round: string; scheduledAt: string | null; status: FixtureStatus; homeClub: string; awayClub: string; score: string | null }> }>;
  topScorers: Array<{ playerId: number; player: string; clubs: string; goals: number }>;
}
