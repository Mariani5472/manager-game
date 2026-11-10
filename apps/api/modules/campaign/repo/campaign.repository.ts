import type {
  CampaignCalendarResponse,
  CampaignOverviewResponse,
  CampaignSquadResponse,
  CampaignTeamResponse,
  CampaignCompetitionDetailResponse,
  MatchCenterResponse,
  MatchPreparationResponse,
  MatchTacticalChangeRequest,
  SaveMatchLineupRequest,
} from "../../../../shared/src/index.js";

export interface CampaignRepository {
  overview(saveId: string): CampaignOverviewResponse;
  calendar(saveId: string): CampaignCalendarResponse;
  competition(saveId: string, stageId: number): CampaignCompetitionDetailResponse;
  squad(saveId: string): CampaignSquadResponse;
  team(saveId: string): CampaignTeamResponse;
  matchPreparation(saveId: string, fixtureId: number): MatchPreparationResponse;
  saveMatchLineup(
    saveId: string,
    fixtureId: number,
    input: SaveMatchLineupRequest,
  ): MatchPreparationResponse;
  matchCenter(saveId: string, fixtureId: number): MatchCenterResponse;
  matchHistory(saveId: string, fixtureId: number): MatchCenterResponse;
  advanceMatch(
    saveId: string,
    fixtureId: number,
    throughMinute: number,
  ): MatchCenterResponse;
  scheduleTacticalChange(
    saveId: string,
    fixtureId: number,
    input: MatchTacticalChangeRequest,
  ): { changeId: number };
}
