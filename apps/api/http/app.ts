import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { existsSync } from "node:fs";
import { z } from "zod";
import { open, validate } from "../db/database.js";
import { masterPath, saveDir } from "../client/config.js";
import { SaveManager } from "../save/saveManager.js";
import { listInstalledDataPackages } from "../game/dataPackages/installedPackagesService.js";

const app = express();

app.use(cors({ origin: process.env.WEB_ORIGIN?.split(",") ?? true }));
app.use(express.json({ limit: "1mb" }));

const newCareerSchema = z.object({
  managerName: z.string().trim().min(2).max(60),
  saveName: z.string().trim().min(2).max(80),
  clubId: z.coerce.number().int().positive(),
});

function withMaster<T>(handler: (db: ReturnType<typeof open>) => T): T {
  if (!existsSync(masterPath)) {
    throw Object.assign(new Error("Master database is not initialized. Run \"npm run dev -- init-master\" in the project root."), { status: 409 });
  }
  const db = open(masterPath, true);
  try {
    validate(db);
    return handler(db);
  } finally {
    db.close();
  }
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "manager-game-api" });
});

app.get("/api/master/overview", (_request, response, next) => {
  try {
    const overview = withMaster((db) => {
      const dataPackages = listInstalledDataPackages(db).map((item) => {
        let manifest: { dependencies?: Array<{ id: string; version?: string }> } = {};
        try { manifest = JSON.parse(item.dependencies) as typeof manifest; } catch { /* Preserve package entry when old metadata is malformed. */ }
        return { id: item.id, version: item.version, installedAt: item.installedAt, dependencies: manifest.dependencies ?? [] };
      });
      const countries = db.prepare(`
        SELECT n.id, n.name, n.code, COUNT(c.id) AS clubCount
        FROM nation n LEFT JOIN club c ON c.nation_id = n.id
        GROUP BY n.id, n.name, n.code
        ORDER BY n.name
      `).all();
      return { dataPackages, countries };
    });
    response.json(overview);
  } catch (error) { next(error); }
});

app.get("/api/master/countries", (_request, response, next) => {
  try {
    const countries = withMaster((db) => db.prepare(`
      SELECT n.id, n.name, n.code, COUNT(c.id) AS clubCount
      FROM nation n LEFT JOIN club c ON c.nation_id = n.id
      GROUP BY n.id, n.name, n.code ORDER BY n.name
    `).all());
    response.json({ countries });
  } catch (error) { next(error); }
});

app.get("/api/master/countries/:countryId/clubs", (request, response, next) => {
  try {
    const countryId = z.coerce.number().int().positive().parse(request.params.countryId);
    const result = withMaster((db) => {
      const country = db.prepare("SELECT id, name, code FROM nation WHERE id = ?").get(countryId);
      if (!country) return null;
      const clubs = db.prepare(`
        SELECT c.id, c.name, c.short_name AS shortName, c.reputation,
               ci.name AS city, s.name AS stadium
        FROM club c
        LEFT JOIN city ci ON ci.id = c.city_id
        LEFT JOIN stadium s ON s.club_id = c.id
        WHERE c.nation_id = ?
        ORDER BY c.reputation DESC, c.name
      `).all(countryId);
      return { country, clubs };
    });
    if (!result) { response.status(404).json({ error: "Country not found." }); return; }
    response.json(result);
  } catch (error) { next(error); }
});

app.get("/api/saves", (_request, response, next) => {
  try {
    const saves = new SaveManager(masterPath, saveDir).list()
      .map(({ filePath: _filePath, ...save }) => save);
    response.json({ saves });
  } catch (error) { next(error); }
});

app.post("/api/saves", async (request, response, next) => {
  try {
    const input = newCareerSchema.parse(request.body);
    const save = await new SaveManager(masterPath, saveDir).create({
      managerName: input.managerName,
      name: input.saveName,
      clubId: input.clubId,
    });
    const { filePath: _filePath, ...publicSave } = save;
    response.status(201).json({ save: publicSave });
  } catch (error) { next(error); }
});

app.post("/api/saves/:saveId/open", (request, response, next) => {
  try {
    const saveId = z.string().uuid().parse(request.params.saveId);
    const db = new SaveManager(masterPath, saveDir).openById(saveId);
    db.close();
    response.json({ opened: true, saveId });
  } catch (error) { next(error); }
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  const status = typeof error?.status === "number" ? error.status : error instanceof z.ZodError ? 400 : 500;
  response.status(status).json({
    error: error instanceof Error ? error.message : "Unexpected API error.",
    ...(error instanceof z.ZodError ? { issues: error.issues } : {}),
  });
};
app.use(errorHandler);

export default app;
