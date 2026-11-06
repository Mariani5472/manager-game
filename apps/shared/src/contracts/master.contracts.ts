export interface DataPackageDependencyDto {
  id: string;
  version?: string;
}

export interface DataPackageSummaryDto {
  id: string;
  version: string;
  installedAt: string;
  dependencies: DataPackageDependencyDto[];
}

export interface CountrySummaryDto {
  id: number;
  name: string;
  code: string | null;
  clubCount: number;
}

export interface ClubSummaryDto {
  id: number;
  name: string;
  shortName: string | null;
  reputation: number;
  city: string | null;
  stadium: string | null;
}

export interface CountryDto {
  id: number;
  name: string;
  code: string | null;
}

export interface MasterOverviewResponse {
  dataPackages: DataPackageSummaryDto[];
  countries: CountrySummaryDto[];
}

export interface CountryClubsResponse {
  country: CountryDto;
  clubs: ClubSummaryDto[];
}
