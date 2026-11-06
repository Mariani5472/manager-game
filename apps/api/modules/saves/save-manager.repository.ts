import { masterPath, saveDir } from "../../client/config.js";
import { SaveManager } from "../../save/saveManager.js";
import type { CreateCareerRequest, SaveSummaryDto } from "../../../shared/src/index.js";
import type { SaveRepository } from "./save.repository.js";

export class SaveManagerRepository implements SaveRepository {
  private readonly saveManager = new SaveManager(masterPath, saveDir);

  list(): SaveSummaryDto[] {
    return this.saveManager.list().map(({ filePath: _filePath, ...save }) => save);
  }

  create(input: Omit<CreateCareerRequest, "countryId">): Promise<SaveSummaryDto> {
    return this.saveManager.create({
      managerName: input.managerName,
      name: input.saveName,
      clubId: input.clubId,
    }).then(({ filePath: _filePath, ...save }) => save);
  }

  open(saveId: string): void {
    const database = this.saveManager.openById(saveId);
    database.close();
  }
}
