import type { SqliteDatabase } from "../db/database.js";
import { simulateMatch, type MatchSummary } from "./matchEngine.js";

export interface FixtureInfo {
  id: number;
  competition: string;
  stage: string;
  round: string;
  scheduledAt: string | null;
  homeClub: string;
  awayClub: string;
  status: string;
  score: string | null;
}

export function listClubs(db: SqliteDatabase): Array<{ id: number; name: string; nation: string }> {
  return db.prepare(`
    SELECT c.id, c.name, n.name AS nation
    FROM club c JOIN nation n ON n.id = c.nation_id
    ORDER BY c.reputation DESC, c.name
  `).all() as Array<{ id: number; name: string; nation: string }>;
}

export function listFixtures(db: SqliteDatabase, pendingOnly = false): FixtureInfo[] {
  const statusFilter = pendingOnly ? "WHERE f.status = 'SCHEDULED'" : "";
  return db.prepare(`
    SELECT f.id, co.name AS competition, st.name AS stage, r.name AS round,
           f.scheduled_at AS scheduledAt, home.name AS homeClub, away.name AS awayClub,
           f.status,
           CASE WHEN f.home_score IS NULL OR f.away_score IS NULL THEN NULL
                ELSE f.home_score || ' - ' || f.away_score END AS score
    FROM fixture f
    JOIN competition_round r ON r.id = f.round_id
    JOIN competition_stage st ON st.id = r.stage_id
    JOIN competition_season cs ON cs.id = st.season_id
    JOIN competition co ON co.id = cs.competition_id
    JOIN club home ON home.id = f.home_club_id
    JOIN club away ON away.id = f.away_club_id
    ${statusFilter}
    ORDER BY f.scheduled_at, f.id
  `).all() as FixtureInfo[];
}

export function advanceNextFixture(db: SqliteDatabase, fixtureId?: number): MatchSummary {
  const row = fixtureId
    ? (db.prepare("SELECT id FROM fixture WHERE id = ? AND status = 'SCHEDULED'").get(fixtureId) as {id:number}|undefined)
    : (db.prepare("SELECT id FROM fixture WHERE status = 'SCHEDULED' ORDER BY scheduled_at, id LIMIT 1").get() as {id:number}|undefined);
  if (!row) throw new Error(fixtureId ? `Scheduled fixture ${fixtureId} not found.` : "No scheduled fixtures remain.");
  return simulateMatch(db, row.id);
}

export function advanceRound(db: SqliteDatabase, roundId: number): MatchSummary[] {
  const fixtures = db.prepare(`
    SELECT id FROM fixture WHERE round_id = ? AND status = 'SCHEDULED' ORDER BY scheduled_at, id
  `).all(roundId) as Array<{id:number}>;
  const results: MatchSummary[] = [];
  for (const fixture of fixtures) results.push(simulateMatch(db, fixture.id));
  return results;
}
