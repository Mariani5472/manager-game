import type {
  ClubSummaryDto,
  CountryClubsResponse,
  CreateCareerRequest,
  CreateCareerResponse,
  ListSavesResponse,
  MasterOverviewResponse,
  OpenSaveResponse,
} from "@shared/index";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "API request failed.");
  }
  return payload as T;
}

export const gameApi = {
  overview: () => request<MasterOverviewResponse>("/api/master/overview"),
  clubs: (countryId: number) =>
    request<CountryClubsResponse>(`/api/master/countries/${countryId}/clubs`),
  saves: () => request<ListSavesResponse>("/api/saves"),
  createSave: (input: CreateCareerRequest) =>
    request<CreateCareerResponse>("/api/saves", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  openSave: (saveId: string) =>
    request<OpenSaveResponse>(`/api/saves/${saveId}/open`, { method: "POST" }),
};

export type { ClubSummaryDto };
