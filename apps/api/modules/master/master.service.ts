import { ApplicationError } from "../../shared/application-error.js";
import type { MasterRepository } from "./master.repository.js";

export class MasterService {
  constructor(private readonly masterRepository: MasterRepository) {}

  getOverview() {
    return { countries: this.masterRepository.listCountries() };
  }

  getCountryClubs(countryId: number) {
    const result = this.masterRepository.findCountryClubs(countryId);
    if (!result) {
      throw ApplicationError.notFound(`Country ${countryId} was not found.`, "COUNTRY_NOT_FOUND");
    }
    return result;
  }

  assertClubBelongsToCountry(clubId: number, countryId: number): void {
    const actualCountryId = this.masterRepository.findClubCountryId(clubId);
    if (actualCountryId === null || actualCountryId !== countryId) {
      throw ApplicationError.badRequest(
        "Selected club does not belong to the selected country.",
        "CLUB_COUNTRY_MISMATCH",
      );
    }
  }
}
