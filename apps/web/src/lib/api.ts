const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

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

export type DataPackageSummary = {
  id: string;
  version: string;
  installedAt: string;
  dependencies: Array<{ id: string; version?: string }>;
};
export type Country = { id: number; name: string; code: string | null; clubCount: number };
export type Club = {
  id: number;
  name: string;
  shortName: string | null;
  reputation: number;
  city: string | null;
  stadium: string | null;
};
export type Save = {
  id: string;
  name: string;
  managerName: string;
  clubId: number;
  createdAt: string;
};

export const gameApi = {
  overview: () => request<{ dataPackages: DataPackageSummary[]; countries: Country[] }>("/api/master/overview"),
  clubs: (countryId: number) => request<{ country: Pick<Country, "id" | "name" | "code">; clubs: Club[] }>(`/api/master/countries/${countryId}/clubs`),
  saves: () => request<{ saves: Save[] }>("/api/saves"),
  createSave: (input: { managerName: string; saveName: string; clubId: number }) =>
    request<{ save: Save }>("/api/saves", { method: "POST", body: JSON.stringify(input) }),
  openSave: (saveId: string) =>
    request<{ opened: boolean; saveId: string }>(`/api/saves/${saveId}/open`, { method: "POST" }),
};
