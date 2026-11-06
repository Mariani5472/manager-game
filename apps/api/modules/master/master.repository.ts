import type {
  CountryClubsResponse,
  CountrySummaryDto,
} from "../../../shared/src/index.js";

export interface MasterRepository {
  listCountries(): CountrySummaryDto[];
  findCountryClubs(countryId: number): CountryClubsResponse | null;
  findClubCountryId(clubId: number): number | null;
}
