import { http, HttpResponse } from "msw";

export const handlers = [
  http.get("/api/master/clubs", () => HttpResponse.json({ ready: true, clubs: [] })),
  http.get("/api/saves", () => HttpResponse.json({ saves: [] })),
];
