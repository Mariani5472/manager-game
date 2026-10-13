import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase } from "../db/database.js";
import { SaveManager } from "../save/saveManager.js";
import { advanceNextFixture, advanceRound, getManagedClub, getSeasonStatus, getStandings, listClubs, listFixtures, listSquad, getTactics } from "../game/gameService.js";
import { previewLineup, saveLineup } from "../game/lineupService.js";

const root = process.cwd();
const masterPath = resolve(process.env.GMF_MASTER_DB ?? "data/master.sqlite");
const savesDir = resolve(process.env.GMF_SAVES_DIR ?? "data/saves");
const htmlPath = resolve(root, "public/manager.html");
const port = Number(process.env.PORT ?? 4173);
const manager = new SaveManager(masterPath, savesDir);

function withDb(saveId: string, fn: (db: ReturnType<typeof openDatabase>) => unknown): unknown {
  if (!saveId || !/^[a-f0-9-]{20,40}$/i.test(saveId)) throw new Error("Informe um save-id válido.");
  const db = manager.openById(saveId);
  try { return fn(db); } finally { db.close(); }
}
function json(res: import("node:http").ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(value));
}
async function body(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ""; for await (const chunk of req) raw += chunk;
  if (raw.length > 1_000_000) throw new Error("Requisição muito grande.");
  return JSON.parse(raw || "{}") as Record<string, unknown>;
}
function positiveInt(value: unknown, label: string): number {
  const n = Number(value); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(label + " inválido."); return n;
}

export function startManagerWebServer(): void {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(readFileSync(htmlPath)); return;
      }
      if (req.method === "GET" && url.pathname === "/api/clubs") {
        const db = openDatabase(masterPath, true);
        try { json(res, 200, listClubs(db)); } finally { db.close(); }
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/campaign") {
        const input = await body(req);
        const name = String(input.name ?? "").trim();
        const managerName = String(input.managerName ?? "").trim();
        const clubId = positiveInt(input.clubId, "clubId");
        const save = await manager.create({ name, managerName, clubId });
        json(res, 201, save);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        const saveId = url.searchParams.get("saveId") ?? "";
        const state = withDb(saveId, db => {
          const managed = getManagedClub(db);
          const fixtures = listFixtures(db);
          const stages = getSeasonStatus(db);
          const selectedStage = Number(url.searchParams.get("stageId")) || stages.find(s => s.stageStatus === "IN_PROGRESS")?.stageId || stages[0]?.stageId;
          const standings = selectedStage ? getStandings(db, selectedStage) : [];
          const upcoming = fixtures.filter(f => f.status === "SCHEDULED").slice(0, 8);
          const recent = fixtures.filter(f => f.status === "COMPLETED").slice(-8).reverse();
          const requestedFixtureId = Number(url.searchParams.get("fixtureId")) || 0;
          const selectedFixture = fixtures.find(f => f.id === requestedFixtureId) ?? fixtures.find(f => f.status === "SCHEDULED" && (f.homeClub === managed.name || f.awayClub === managed.name)) ?? upcoming[0];
          const squad = listSquad(db, managed.id);
          const tactics = getTactics(db, managed.id);
          let lineup: { starters: number[]; bench: number[] } | null = null;
          if (selectedFixture && selectedFixture.status === "SCHEDULED" &&
              (selectedFixture.homeClub === managed.name || selectedFixture.awayClub === managed.name)) {
            const savedLineup = db.prepare("SELECT player_id AS playerId, is_starting AS isStarting FROM match_lineup WHERE fixture_id=? AND club_id=? ORDER BY slot_number")
              .all(selectedFixture.id, managed.id) as Array<{playerId:number;isStarting:number}>;
            if (savedLineup.filter(p => p.isStarting === 1).length === 11) {
              lineup = { starters: savedLineup.filter(p => p.isStarting === 1).map(p => p.playerId), bench: savedLineup.filter(p => p.isStarting === 0).map(p => p.playerId) };
            } else {
              const preview = previewLineup(db, managed.id, selectedFixture.id);
              const defaults = saveLineup(db, selectedFixture.id, managed.id, preview.starters.map(p => p.playerId), preview.bench.map(p => p.playerId));
              lineup = { starters: defaults.starters.map(p => p.playerId), bench: defaults.bench.map(p => p.playerId) };
            }
          }
          const matchDetails = selectedFixture ? {
            fixture: selectedFixture,
            momentum: db.prepare("SELECT minute,home_pressure AS homePressure,away_pressure AS awayPressure,home_score AS homeScore,away_score AS awayScore FROM match_momentum WHERE fixture_id=? ORDER BY minute").all(selectedFixture.id),
            events: db.prepare("SELECT minute,event_type AS type,description,xg FROM match_event WHERE fixture_id=? ORDER BY minute,id").all(selectedFixture.id),
            stats: db.prepare("SELECT club_id AS clubId, SUM(CASE WHEN event_type IN ('GOAL','SAVE','MISS') THEN 1 ELSE 0 END) AS shots, SUM(CASE WHEN event_type IN ('GOAL','SAVE') THEN 1 ELSE 0 END) AS shotsOnTarget, ROUND(COALESCE(SUM(xg),0),2) AS xg FROM match_event WHERE fixture_id=? GROUP BY club_id ORDER BY CASE club_id WHEN (SELECT home_club_id FROM fixture WHERE id=?) THEN 0 ELSE 1 END").all(selectedFixture.id, selectedFixture.id)
          } : null;
          const formations = db.prepare("SELECT id,name FROM formation ORDER BY name").all();
          return { managed, fixtures, stages, selectedStage, standings, upcoming, recent, squad, tactics, formations, selectedFixture, matchDetails, lineup };
        });
        json(res, 200, state); return;
      }
      if (req.method === "POST" && url.pathname === "/api/lineup") {
        const input = await body(req);
        const result = withDb(String(input.saveId ?? ""), db => saveLineup(db, positiveInt(input.fixtureId,"fixtureId"), positiveInt(input.clubId,"clubId"), (input.starterIds as unknown[]).map(x=>positiveInt(x,"playerId")), ((input.benchIds ?? []) as unknown[]).map(x=>positiveInt(x,"playerId"))));
        json(res, 200, result); return;
      }
      if (req.method === "POST" && url.pathname === "/api/tactics") {
        const input = await body(req);
        const result = withDb(String(input.saveId ?? ""), db => {
          const clubId = positiveInt(input.clubId,"clubId");
          const formationId = positiveInt(input.formationId,"formationId");
          const mentality = String(input.mentality);
          if (!["VERY_DEFENSIVE","DEFENSIVE","BALANCED","ATTACKING","VERY_ATTACKING"].includes(mentality)) throw new Error("Mentalidade inválida.");
          const numeric = ["pressing","tempo","defensiveLine","width","passingDirectness"] as const;
          const values = numeric.map(key => Number(input[key]));
          if (values.some(n => !Number.isInteger(n) || n < 0 || n > 100)) throw new Error("Atributos táticos devem estar entre 0 e 100.");
          if (!db.prepare("SELECT 1 FROM formation WHERE id=?").get(formationId)) throw new Error("Formação não encontrada.");
          db.prepare("UPDATE team_tactic SET formation_id=?,mentality=?,pressing=?,tempo=?,defensive_line=?,width=?,passing_directness=?,counter_attack=? WHERE club_id=?")
            .run(formationId,mentality,...values,input.counterAttack ? 1 : 0,clubId);
          return getTactics(db,clubId);
        });
        json(res, 200, result); return;
      }
      if (req.method === "POST" && url.pathname === "/api/play") {
        const input = await body(req);
        const result = withDb(String(input.saveId ?? ""), db => {
          const fixtureId = positiveInt(input.fixtureId,"fixtureId");
          const fixture = db.prepare("SELECT round_id AS roundId FROM fixture WHERE id=? AND status IN ('SCHEDULED','IN_PROGRESS')").get(fixtureId) as {roundId:number}|undefined;
          if (!fixture) throw new Error("Partida não encontrada ou já concluída.");
          return { roundId: fixture.roundId, matches: advanceRound(db, fixture.roundId) };
        });
        json(res, 200, result); return;
      }
      if (req.method === "POST" && url.pathname === "/api/play-next") {
        const input = await body(req);
        const result = withDb(String(input.saveId ?? ""), db => {
          const managed = getManagedClub(db);
          const fixture = db.prepare(`
            SELECT f.id, f.round_id AS roundId FROM fixture f
            JOIN competition_round r ON r.id=f.round_id
            WHERE f.status IN ('SCHEDULED','IN_PROGRESS')
              AND (f.home_club_id=? OR f.away_club_id=?)
            ORDER BY CASE f.status WHEN 'IN_PROGRESS' THEN 0 ELSE 1 END, f.scheduled_at, f.id
            LIMIT 1
          `).get(managed.id, managed.id) as {id:number;roundId:number}|undefined;
          if (!fixture) throw new Error("Seu clube não tem partidas pendentes.");
          return { roundId: fixture.roundId, managedFixtureId: fixture.id, matches: advanceRound(db, fixture.roundId) };
        });
        json(res, 200, result); return;
      }
      json(res, 404, { error: "Rota não encontrada." });
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : "Erro inesperado." });
    }
  });
  server.listen(port, "0.0.0.0", () => console.log("Manager UI disponível na porta " + port));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) startManagerWebServer();
