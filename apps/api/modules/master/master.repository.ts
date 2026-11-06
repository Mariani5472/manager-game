import type {
  ClubSummaryDto,
  CountryClubsResponse,
  CountrySummaryDto,
  DataPackageSummaryDto,
} from "../../../shared/src/index.js";

export interface MasterRepository {
  getInstalledDataPackages(): DataPackageSummaryDto[];
  listCountries(): CountrySummaryDto[];
  findCountryClubs(countryId: number): CountryClubsResponse | null;
  findClubCountryId(clubId: number): number | null;
}
