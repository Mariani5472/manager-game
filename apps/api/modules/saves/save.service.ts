import { ApplicationError } from "../../shared/application-error.js";
import type { CreateCareerRequest } from "../../../shared/src/index.js";
import type { MasterService } from "../master/master.service.js";
import type { SaveRepository } from "./save.repository.js";

export class SaveService {
  constructor(
    private readonly saveRepository: SaveRepository,
    private readonly masterService: MasterService,
  ) {}

  list() {
    return this.saveRepository.list();
  }

  async createCareer(input: CreateCareerRequest) {
    this.masterService.assertClubBelongsToCountry(input.clubId, input.countryId);
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
