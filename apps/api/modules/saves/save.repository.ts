import type { CreateCareerRequest, SaveSummaryDto } from "../../../shared/src/index.js";

export interface SaveRepository {
  list(): SaveSummaryDto[];
  create(input: CreateCareerRequest): Promise<SaveSummaryDto>;
  open(saveId: string): void;
}
