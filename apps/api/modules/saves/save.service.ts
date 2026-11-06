import { ApplicationError } from "../../shared/application-error.js";
import type { CreateCareerRequest } from "../../../shared/src/index.js";
import type { SaveRepository } from "./save.repository.js";

export interface ClubCountryValidator {
  assertClubBelongsToCountry(clubId: number, countryId: number): void;
}

export class SaveService {
  constructor(
    private readonly saveRepository: SaveRepository,
    private readonly clubCountryValidator: ClubCountryValidator,
  ) {}

  list() {
    return this.saveRepository.list();
  }

  async createCareer(input: CreateCareerRequest) {
    this.clubCountryValidator.assertClubBelongsToCountry(input.clubId, input.countryId);
    return this.saveRepository.create(input);
  }

  open(saveId: string): void {
    try {
      this.saveRepository.open(saveId);
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw ApplicationError.notFound(error.message, "SAVE_NOT_FOUND");
      }
      throw error;
    }
  }
}
