import type { CreateCareerRequest, SaveSummaryDto } from "../../../shared/src/index.js";

export interface SaveRepository {
  list(): SaveSummaryDto[];
  create(input: Omit<CreateCareerRequest, "countryId">): Promise<SaveSummaryDto>;
  open(saveId: string): void;
}
