export interface SaveSummaryDto {
  id: string;
  name: string;
  managerName: string;
  clubId: number;
  createdAt: string;
}

export interface CreateCareerRequest {
  managerName: string;
  saveName: string;
  countryId: number;
  clubId: number;
}

export interface CreateCareerResponse {
  save: SaveSummaryDto;
}

export interface ListSavesResponse {
  saves: SaveSummaryDto[];
}

export interface OpenSaveResponse {
  opened: boolean;
  saveId: string;
}
