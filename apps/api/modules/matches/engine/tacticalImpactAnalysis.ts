import type { SqliteDatabase } from "../../../db/database.js";
import { runMonteCarlo } from "./monteCarloService.js";
import { loadTeam } from "./teamService.js";
import type {
  TacticalImpactReport,
  TacticalImpactScenario,
  Team,
} from "../types/match-engine.types.js";

export function runTacticalImpactAnalysis(
  db: SqliteDatabase,
  homeClubId: number,
  awayClubId: number,
  simulations = 5000,
  seed = 73421,
): TacticalImpactReport {
  if (homeClubId === awayClubId)
    throw new Error("Tactical impact analysis requires two different clubs.");
  if (!Number.isSafeInteger(simulations) || simulations < 100)
    throw new Error("Tactical impact simulations must be an integer >= 100.");
  const home = loadTeam(db, -1, homeClubId, false),
    away = loadTeam(db, -1, awayClubId, false);
  const cases = [
    {
      name: "baseline",
      description: "Táticas atuais dos dois clubes.",
      homePatch: {},
      awayPatch: {},
    },
    {
      name: "home_attacking",
      description:
        "Mandante com mentalidade muito ofensiva, pressão e ritmo altos.",
      homePatch: {
        mentality: "VERY_ATTACKING",
        pressing: 85,
        tempo: 80,
        defensive_line: 65,
      },
      awayPatch: {},
    },
    {
      name: "home_defensive",
      description: "Mandante defensivo, com pressão e ritmo baixos.",
      homePatch: {
        mentality: "DEFENSIVE",
        pressing: 35,
        tempo: 35,
        defensive_line: 35,
      },
      awayPatch: {},
    },
    {
      name: "away_high_press",
      description: "Visitante muito ofensivo, com pressão alta.",
      homePatch: {},
      awayPatch: {
        mentality: "VERY_ATTACKING",
        pressing: 90,
        tempo: 80,
        defensive_line: 65,
      },
    },
  ] as const;
  const base = runMonteCarlo(home, away, simulations, seed);
  const scenarios: TacticalImpactScenario[] = cases.map((c) => {
    const h: Team = { ...home, tactic: { ...home.tactic, ...c.homePatch } };
    const a: Team = { ...away, tactic: { ...away.tactic, ...c.awayPatch } };
    const result =
      c.name === "baseline" ? base : runMonteCarlo(h, a, simulations, seed);
    return {
      name: c.name,
      description: c.description,
      result,
      homeWinRateDelta: result.homeWinRate - base.homeWinRate,
      averageHomeGoalsDelta: result.averageHomeGoals - base.averageHomeGoals,
      homeShotsDelta: result.homeShotRate - base.homeShotRate,
      averageTotalXgDelta: result.averageTotalXg - base.averageTotalXg,
    };
  });
  return { homeClubId, awayClubId, simulations, seed, scenarios };
}
