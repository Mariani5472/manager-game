import type { DataPackageSummaryDto } from "../../../shared/src/index.js";

export interface DataPackageRepository {
  listInstalled(): DataPackageSummaryDto[];
}
