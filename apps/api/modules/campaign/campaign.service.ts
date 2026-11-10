import type {
  MatchTacticalChangeRequest,
  SaveMatchLineupRequest,
} from "../../../shared/src/index.js";
import { ApplicationError } from "../../shared/application-error.js";
import { SaveNotFoundError } from "../saves/save-not-found.error.js";
import type { CampaignRepository } from "./repo/campaign.repository.js";

export class CampaignService {
  constructor(private readonly repository: CampaignRepository) {}

  private execute<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      if (error instanceof SaveNotFoundError) {
        throw ApplicationError.notFound(error.message, "SAVE_NOT_FOUND");
      }
      throw error;
    }
  }

  overview(id: string) {
    return this.execute(() => this.repository.overview(id));
  }
  calendar(id: string) {
    return this.execute(() => this.repository.calendar(id));
  }
  squad(id: string) {
    return this.execute(() => this.repository.squad(id));
  }
  team(id: string) {
    return this.execute(() => this.repository.team(id));
  }
  matchPreparation(id: string, fixtureId: number) {
    return this.execute(() => this.repository.matchPreparation(id, fixtureId));
  }
  saveMatchLineup(
    id: string,
    fixtureId: number,
    input: SaveMatchLineupRequest,
  ) {
    return this.execute(() =>
      this.repository.saveMatchLineup(id, fixtureId, input),
    );
  }
  matchCenter(id: string, fixtureId: number) {
    return this.execute(() => this.repository.matchCenter(id, fixtureId));
  }
  matchHistory(id: string, fixtureId: number) {
    return this.execute(() => this.repository.matchHistory(id, fixtureId));
  }
  advanceMatch(id: string, fixtureId: number, throughMinute: number) {
    return this.execute(() =>
      this.repository.advanceMatch(id, fixtureId, throughMinute),
    );
  }
  scheduleTacticalChange(
    id: string,
    fixtureId: number,
    input: MatchTacticalChangeRequest,
  ) {
    return this.execute(() =>
      this.repository.scheduleTacticalChange(id, fixtureId, input),
    );
  }
}
