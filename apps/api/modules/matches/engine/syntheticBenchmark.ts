import {
  performance,
} from "node:perf_hooks";
import type {
  SqliteDatabase,
} from "../../../db/database.js";
import {
  loadTeam,
} from "./teamService.js";
import {
  simulateMatchKernel,
} from "./timelineSimulator.js";
import type {
  SyntheticScaleBenchmark,
  Team,
} from "./types.js";


/**
 * Reproducible CPU-only scalability benchmark. Teams beyond the real save size
 * reuse immutable squad/tactic profiles from that save, with unique synthetic
 * club IDs. It measures engine throughput, not the cost of generating 256 real
 * squads or persisting a 256-club database.
 */
export function runSyntheticSeasonScaleBenchmarks(
  db: SqliteDatabase,
  sizes: number[] = [16, 64, 256],
  seed = 90210
): SyntheticScaleBenchmark[] {
    if (!sizes.length || sizes.some(size => !Number.isSafeInteger(size) || size < 4 || size > 512)) {
      throw new Error("Benchmark scales must contain club counts between 4 and 512.");
    }
    if (!Number.isSafeInteger(seed) || seed < 0) throw new Error("Benchmark seed must be a non-negative integer.");
    const ids = (db.prepare("SELECT id FROM club ORDER BY id").all() as Array<{id:number}>).map(row => row.id);
    if (ids.length < 4) throw new Error("Scalability benchmarks require at least four source clubs.");
    const templates = ids.map(id => loadTeam(db, -1, id, false));
    return [...new Set(sizes)].sort((a,b)=>a-b).map(clubs => {
      const teams: Team[] = Array.from({length:clubs}, (_,index) => {
        const template = templates[index % templates.length]!;
        return {...template, clubId:index + 1, tactic:{...template.tactic}, lineup:template.lineup.map(player=>({...player}))};
      });
      let state = 0, goals = 0, draws = 0;
      const matches = clubs * (clubs - 1);
      const started = performance.now();
      let matchIndex = 0;
      for (let homeIndex=0;homeIndex<clubs;homeIndex++) {
        for (let awayIndex=0;awayIndex<clubs;awayIndex++) {
          if (homeIndex === awayIndex) continue;
          const result = simulateMatchKernel(teams[homeIndex]!,teams[awayIndex]!,
            (seed + clubs * 1000003 + matchIndex * 7919) >>> 0);
          goals += result.homeScore + result.awayScore;
          if (result.homeScore === result.awayScore) draws++;
          matchIndex++;
        }
      }
      const durationMs = performance.now() - started;
      state = matchIndex;
      if (state !== matches) throw new Error("Synthetic benchmark match-count invariant failed.");
      return {clubs,matches,seed,durationMs,matchesPerSecond:durationMs > 0 ? matches/(durationMs/1000) : matches,
        averageGoalsPerMatch:goals/matches,drawRate:draws/matches};
    });
  }