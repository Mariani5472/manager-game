import { simulateMatchTimeline } from "./timelineSimulator.js";
import type { MonteCarloReport, Team } from "../types/match-engine.types.js";

export function runMonteCarlo(
  home: Team,
  away: Team,
  simulations = 5000,
  seed = 73421,
): MonteCarloReport {
  if (!Number.isSafeInteger(simulations) || simulations < 100)
    throw new Error("Monte Carlo simulations must be an integer >= 100.");
  let hw = 0,
    d = 0,
    aw = 0,
    hg = 0,
    ag = 0,
    hs = 0,
    as = 0,
    hon = 0,
    aon = 0,
    hxg = 0,
    axg = 0,
    diff = 0;
  let goalless = 0,
    anyFivePlus = 0,
    sixPlusTotal = 0,
    homeByThree = 0,
    awayByThree = 0,
    maxTeamGoals = 0,
    maxTotalGoals = 0;
  for (let i = 0; i < simulations; i++) {
    const r = simulateMatchTimeline(home, away, seed + i * 7919).result;
    if (r.homeScore > r.awayScore) hw++;
    else if (r.homeScore === r.awayScore) d++;
    else aw++;
    hg += r.homeScore;
    ag += r.awayScore;
    hs += r.homeShots;
    as += r.awayShots;
    hon += r.homeShotsOnTarget;
    aon += r.awayShotsOnTarget;
    hxg += r.homeXg;
    axg += r.awayXg;
    diff += Math.abs(r.homeScore - r.awayScore);
    const total = r.homeScore + r.awayScore;
    if (total === 0) goalless++;
    if (Math.max(r.homeScore, r.awayScore) >= 5) anyFivePlus++;
    if (total >= 6) sixPlusTotal++;
    if (r.homeScore - r.awayScore >= 3) homeByThree++;
    if (r.awayScore - r.homeScore >= 3) awayByThree++;
    maxTeamGoals = Math.max(maxTeamGoals, r.homeScore, r.awayScore);
    maxTotalGoals = Math.max(maxTotalGoals, total);
  }
  return {
    simulations,
    homeWinRate: hw / simulations,
    drawRate: d / simulations,
    awayWinRate: aw / simulations,
    averageHomeGoals: hg / simulations,
    averageAwayGoals: ag / simulations,
    averageTotalGoals: (hg + ag) / simulations,
    homeShotRate: hs / simulations,
    awayShotRate: as / simulations,
    averageTotalShots: (hs + as) / simulations,
    averageTotalShotsOnTarget: (hon + aon) / simulations,
    averageTotalXg: (hxg + axg) / simulations,
    meanAbsoluteGoalDifference: diff / simulations,
    goallessRate: goalless / simulations,
    anyTeamFivePlusGoalsRate: anyFivePlus / simulations,
    sixPlusTotalGoalsRate: sixPlusTotal / simulations,
    homeWinByThreePlusRate: homeByThree / simulations,
    awayWinByThreePlusRate: awayByThree / simulations,
    maxTeamGoals,
    maxTotalGoals,
  };
}
