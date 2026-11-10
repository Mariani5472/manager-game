import type { SqliteDatabase } from "../../../db/database.js";
import { simulateMatchKernel } from "./timelineSimulator.js";
import { loadTeam } from "./teamService.js";
import type {
  SeasonBalanceClub,
  SeasonBalanceReport,
  Team,
} from "../types/match-engine.types.js";

/**
 * Fast whole-season Monte Carlo:
 * double round robin repeated with distinct seeds.
 */
export function runSeasonBalanceAnalysis(
  db: SqliteDatabase,
  seasons = 20,
  seedStart = 90210,
): SeasonBalanceReport {
  if (!Number.isSafeInteger(seasons) || seasons < 1 || seasons > 500)
    throw new Error("Season simulations must be an integer from 1 to 500.");
  const ids = (
    db.prepare("SELECT id FROM club ORDER BY id").all() as Array<{ id: number }>
  ).map((r) => r.id);
  if (ids.length < 4)
    throw new Error("Season balance analysis requires at least four clubs.");
  const teams = ids.map((id) => loadTeam(db, -1, id, false));
  const strength = (t: Team) =>
    t.attacking * 0.4 + t.defending * 0.35 + t.goalkeeping * 0.25;
  const ranked = [...teams].sort((a, b) => strength(b) - strength(a));
  const tierByClub = new Map<number, string>();
  ranked.forEach((t, i) =>
    tierByClub.set(
      t.clubId,
      i < 3
        ? "ELITE"
        : i < 7
          ? "COMPETITIVE"
          : i < 12
            ? "MID_TABLE"
            : "LOWER_TABLE",
    ),
  );
  const stats = new Map(
    ids.map((id) => [
      id,
      { points: 0, gd: 0, gf: 0, ga: 0, first: 0, topFour: 0, bottomFour: 0 },
    ]),
  );
  let favoriteWins = 0,
    favoriteDecisions = 0,
    underdogWins = 0,
    underdogDecisions = 0,
    draws = 0,
    totalMatches = 0;
  for (let season = 0; season < seasons; season++) {
    const table = new Map(ids.map((id) => [id, { points: 0, gf: 0, ga: 0 }]));
    let matchIndex = 0;
    for (let i = 0; i < teams.length; i++)
      for (let j = i + 1; j < teams.length; j++) {
        const legs: Array<[number, number]> = [
          [i, j],
          [j, i],
        ];
        for (const [homeIndex, awayIndex] of legs) {
          const home = teams[homeIndex]!,
            away = teams[awayIndex]!;
          const result = simulateMatchKernel(
            home,
            away,
            (seedStart + season * 1000003 + matchIndex * 7919) >>> 0,
          );
          matchIndex++;
          totalMatches++;
          const h = table.get(home.clubId)!,
            a = table.get(away.clubId)!;
          h.gf += result.homeScore;
          h.ga += result.awayScore;
          a.gf += result.awayScore;
          a.ga += result.homeScore;
          if (result.homeScore > result.awayScore) h.points += 3;
          else if (result.homeScore < result.awayScore) a.points += 3;
          else {
            h.points++;
            a.points++;
            draws++;
          }
          const gap = strength(home) - strength(away);
          if (Math.abs(gap) >= 5) {
            favoriteDecisions++;
            const favoriteWon =
              gap > 0
                ? result.homeScore > result.awayScore
                : result.awayScore > result.homeScore;
            if (favoriteWon) favoriteWins++;
          }
          if (Math.abs(gap) >= 8) {
            underdogDecisions++;
            const underdogWon =
              gap > 0
                ? result.awayScore > result.homeScore
                : result.homeScore > result.awayScore;
            if (underdogWon) underdogWins++;
          }
        }
      }
    const ordered = [...table.entries()].sort(
      (a, b) =>
        b[1].points - a[1].points ||
        b[1].gf - b[1].ga - (a[1].gf - a[1].ga) ||
        b[1].gf - a[1].gf,
    );
    ordered.forEach(([id, row], rank) => {
      const acc = stats.get(id)!;
      acc.points += row.points;
      acc.gf += row.gf;
      acc.ga += row.ga;
      acc.gd += row.gf - row.ga;
      if (rank === 0) acc.first++;
      if (rank < 4) acc.topFour++;
      if (rank >= ordered.length - 4) acc.bottomFour++;
    });
  }
  const clubs: SeasonBalanceClub[] = ids
    .map((id) => {
      const team = teams.find((t) => t.clubId === id)!;
      const s = stats.get(id)!;
      return {
        clubId: id,
        reputation: team.reputation,
        strength: strength(team),
        tier: tierByClub.get(id)!,
        averagePoints: s.points / seasons,
        averageGoalDifference: s.gd / seasons,
        averageGoalsFor: s.gf / seasons,
        averageGoalsAgainst: s.ga / seasons,
        titleRate: s.first / seasons,
        topFourRate: s.topFour / seasons,
        bottomFourRate: s.bottomFour / seasons,
      };
    })
    .sort((a, b) => b.averagePoints - a.averagePoints);
  const tierSummary = ["ELITE", "COMPETITIVE", "MID_TABLE", "LOWER_TABLE"].map(
    (tier) => {
      const group = clubs.filter((c) => c.tier === tier);
      return {
        tier,
        clubs: group.length,
        averagePoints:
          group.reduce((sum, c) => sum + c.averagePoints, 0) /
          (group.length || 1),
        averageGoalDifference:
          group.reduce((sum, c) => sum + c.averageGoalDifference, 0) /
          (group.length || 1),
        averageGoalsAgainst:
          group.reduce((sum, c) => sum + c.averageGoalsAgainst, 0) /
          (group.length || 1),
      };
    },
  );
  return {
    seasons,
    matchesPerSeason: teams.length * (teams.length - 1),
    totalMatches,
    seedStart,
    favoriteWinRate: favoriteDecisions ? favoriteWins / favoriteDecisions : 0,
    underdogWinRate: underdogDecisions ? underdogWins / underdogDecisions : 0,
    drawRate: totalMatches ? draws / totalMatches : 0,
    upsetDefinition:
      "Favorite/underdog comparisons use a pre-match strength gap of at least 5/8 rating points; ties are not wins.",
    clubs,
    tierSummary,
  };
}
