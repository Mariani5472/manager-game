import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import type { SqliteDatabase } from "../db/database.js";
import { openDatabase, validateDatabase } from "../db/database.js";
import { advanceStageRound } from "./gameService.js";
import { runSyntheticSeasonScaleBenchmarks, simulateMatch } from "./matchEngine.js";
import { applyRosterSeason, createTransferOffer } from "./rosterLifecycle.js";

export interface BenchmarkSample {
  name: string;
  durationMs: number;
  synchronousBlockMs: number;
  heapDeltaBytes: number;
  rssDeltaBytes: number;
  sqlQueryCount: number;
  sqlDurationMs: number;
  slowQueries: Array<{sql:string;durationMs:number}>;
  eventLoopDelayMaxMs: number;
  databaseBytes: number;
  details?: unknown;
}
export interface PerformanceBenchmarkReport {
  generatedAt: string;
  seed: number;
  sourceClubCount: number;
  sourceFixtureCount: number;
  sourceDatabaseBytes: number;
  memoryBefore: {heapUsedBytes:number;rssBytes:number};
  samples: BenchmarkSample[];
  scalability: ReturnType<typeof runSyntheticSeasonScaleBenchmarks>;
  notes: string[];
}
export interface PerformanceBenchmarkOptions {
  seed?: number;
  scales?: number[];
  includeSeason?: boolean;
}

function immediate(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
function memory(): {heapUsedBytes:number;rssBytes:number} {
  const usage=process.memoryUsage();
  return {heapUsedBytes:usage.heapUsed,rssBytes:usage.rss};
}
function databaseBytes(path: string): number {
  return [path,path+"-wal",path+"-shm"].reduce((total,file)=>{
    try { return total+statSync(file).size; } catch { return total; }
  },0);
}
function nextSeasonYear(db: SqliteDatabase): number {
  return ((db.prepare("SELECT COALESCE(MAX(season_year),2026)+1 AS year FROM competition_season").get() as {year:number}).year);
}
async function withDisposableCopy<T>(source: SqliteDatabase, run: (db:SqliteDatabase,path:string)=>Promise<T>|T): Promise<T> {
  const directory=mkdtempSync(join(tmpdir(),"gm-performance-"));
  const path=join(directory,"benchmark.sqlite");
  let copy:SqliteDatabase|undefined;
  try {
    await source.backup(path);
    copy=openDatabase(path);
    return await run(copy,path);
  } finally {
    if(copy?.open) copy.close();
    rmSync(directory,{recursive:true,force:true});
  }
}
async function measure(
  db:SqliteDatabase,
  path:string,
  name:string,
  operation:()=>unknown|Promise<unknown>,
):Promise<BenchmarkSample> {
  let sqlQueryCount=0,sqlDurationNs=0;
  const slowQueries:Array<{sql:string;durationMs:number}>=[];
  const onProfile=(sql:string,nanoseconds:number)=>{
    sqlQueryCount++;
    sqlDurationNs+=nanoseconds;
    const durationMs=nanoseconds/1_000_000;
    if(durationMs>=2) {
      slowQueries.push({sql:sql.slice(0,240),durationMs});
      slowQueries.sort((a,b)=>b.durationMs-a.durationMs);
      if(slowQueries.length>10) slowQueries.length=10;
    }
  };
  const delay=monitorEventLoopDelay({resolution:10});
  const before=memory();
  delay.enable();
  db.on("profile",onProfile);
  await immediate();
  const started=performance.now();
  let syncDurationMs=0;
  let details:unknown;
  let thrown:unknown;
  try {
    const syncStarted=performance.now();
    const result=operation();
    syncDurationMs=performance.now()-syncStarted;
    details=await result;
  } catch(error) {
    thrown=error;
  }
  const durationMs=performance.now()-started;
  await immediate();
  db.removeListener("profile",onProfile);
  delay.disable();
  const after=memory();
  const sample:BenchmarkSample={
    name,durationMs,synchronousBlockMs:syncDurationMs,
    heapDeltaBytes:after.heapUsedBytes-before.heapUsedBytes,
    rssDeltaBytes:after.rssBytes-before.rssBytes,
    sqlQueryCount,sqlDurationMs:sqlDurationNs/1_000_000,
    slowQueries,eventLoopDelayMaxMs:Number(delay.max)/1_000_000,
    databaseBytes:databaseBytes(path),details,
  };
  if(thrown!==undefined) throw thrown;
  return sample;
}
function nextScheduledFixture(db:SqliteDatabase):number {
  const row=db.prepare("SELECT id FROM fixture WHERE status='SCHEDULED' ORDER BY scheduled_at,id LIMIT 1").get() as {id:number}|undefined;
  if(!row) throw new Error("Performance benchmark requires at least one scheduled fixture in the selected save.");
  return row.id;
}
function benchmarkRound(db:SqliteDatabase):unknown {
  const stage=db.prepare(`
    SELECT st.id AS stageId,MIN(r.round_number) AS roundNumber
    FROM competition_stage st JOIN competition_round r ON r.stage_id=st.id
    JOIN fixture f ON f.round_id=r.id
    WHERE st.stage_kind='LEAGUE' AND f.status IN ('SCHEDULED','IN_PROGRESS')
    GROUP BY st.id ORDER BY COUNT(f.id) DESC LIMIT 1
  `).get() as {stageId:number;roundNumber:number}|undefined;
  if(!stage) throw new Error("Round benchmark requires a league stage with scheduled fixtures.");
  return advanceStageRound(db,stage.stageId,stage.roundNumber);
}
function benchmarkCampaignSeason(db:SqliteDatabase):{stages:number;rounds:number;fixtures:number;eventCounts:Array<{type:string;count:number}>;injuredPlayers:number} {
  const stageIds=(db.prepare(`
    SELECT DISTINCT st.id AS id
    FROM competition_stage st JOIN competition_season cs ON cs.id=st.season_id
    JOIN competition_round r ON r.stage_id=st.id JOIN fixture f ON f.round_id=r.id
    WHERE f.status IN ('SCHEDULED','IN_PROGRESS')
    ORDER BY cs.season_year,cs.id,st.stage_order
  `).all() as Array<{id:number}>).map(row=>row.id);
  if(!stageIds.length) throw new Error("Campaign-season benchmark requires scheduled league or cup fixtures.");
  let processedRounds=0,processedFixtures=0;
  for(const stageId of stageIds) {
    for(;;) {
      const round=db.prepare(`
        SELECT r.round_number AS number FROM competition_round r JOIN fixture f ON f.round_id=r.id
        WHERE r.stage_id=? AND f.status IN ('SCHEDULED','IN_PROGRESS')
        ORDER BY r.round_number LIMIT 1
      `).get(stageId) as {number:number}|undefined;
      if(!round) break;
      const results=advanceStageRound(db,stageId,round.number);
      processedRounds++;
      processedFixtures+=results.length;
    }
  }
  const placeholders=stageIds.map(()=>"?").join(",");
  const eventCounts=db.prepare(`
    SELECT e.event_type AS type,COUNT(*) AS count
    FROM match_event e JOIN fixture f ON f.id=e.fixture_id
    JOIN competition_round r ON r.id=f.round_id
    WHERE r.stage_id IN (${placeholders}) GROUP BY e.event_type ORDER BY e.event_type
  `).all(...stageIds) as Array<{type:string;count:number}>;
  const injuredPlayers=(db.prepare("SELECT COUNT(*) AS count FROM player_condition WHERE injured_until IS NOT NULL").get() as {count:number}).count;
  return {stages:stageIds.length,rounds:processedRounds,fixtures:processedFixtures,eventCounts,injuredPlayers};
}

/**
 * Benchmarks a disposable online-backup copy; the caller's campaign is never
 * advanced or mutated. Scale benchmarks reuse real squad/tactic profiles as
 * synthetic clubs, so they isolate engine throughput from world-generation cost.
 */
export async function runPerformanceBenchmark(
  source:SqliteDatabase,
  options:PerformanceBenchmarkOptions={},
):Promise<PerformanceBenchmarkReport> {
  const seed=options.seed??90210;
  const scales=options.scales??[16,64,256];
  if(!Number.isSafeInteger(seed)||seed<0) throw new Error("Benchmark seed must be a non-negative integer.");
  const sourceClubCount=(source.prepare("SELECT COUNT(*) AS count FROM club").get() as {count:number}).count;
  const sourceFixtureCount=(source.prepare("SELECT COUNT(*) AS count FROM fixture").get() as {count:number}).count;
  const sourcePath=(source.name as string|undefined)??"";
  const sourceDatabaseBytes=databaseBytes(sourcePath);
  const memoryBefore=memory();
  const samples:BenchmarkSample[]=[];

  const scaleSample=await measure(source,sourcePath,"engineScalability",()=>runSyntheticSeasonScaleBenchmarks(source,scales,seed));
  const scalability=scaleSample.details as ReturnType<typeof runSyntheticSeasonScaleBenchmarks>;
  samples.push({...scaleSample,details:{scales:scalability.map(row=>({clubs:row.clubs,matches:row.matches}))}});

  samples.push(await withDisposableCopy(source,(db,path)=>measure(db,path,"singleMatchAndPersistence",()=>simulateMatch(db,nextScheduledFixture(db)))));

  samples.push(await withDisposableCopy(source,dbPath=>measure(dbPath,dbPath.name,"roundAndStandings",()=>benchmarkRound(dbPath))));

  if(options.includeSeason!==false) {
    samples.push(await withDisposableCopy(source,db=>measure(db,db.name,"completeCampaignSeason",()=>benchmarkLeagueSeason(db))));
  }

  samples.push(await withDisposableCopy(source,db=>measure(db,db.name,"playerEvolution",()=>applyRosterSeason(db,nextSeasonYear(db)))));

  samples.push(await withDisposableCopy(source,db=>measure(db,db.name,"transferMarketOffer",()=>{
    const player=db.prepare("SELECT p.person_id AS id,sm.club_id AS clubId FROM player p JOIN squad_membership sm ON sm.player_id=p.person_id ORDER BY p.person_id LIMIT 1").get() as {id:number;clubId:number}|undefined;
    if(!player) throw new Error("Market benchmark requires at least one rostered player.");
    const buyer=db.prepare("SELECT id FROM club WHERE id<>? ORDER BY id LIMIT 1").get(player.clubId) as {id:number}|undefined;
    if(!buyer) throw new Error("Market benchmark requires at least two clubs.");
    return createTransferOffer(db,player.id,buyer.id,0,0,1,nextSeasonYear(db));
  })));

  samples.push(await withDisposableCopy(source,db=>measure(db,db.name,"sqliteValidationAndPersistence",()=>{
    validateDatabase(db);
    const pages=db.pragma("page_count",{simple:true}) as number;
    const pageSize=db.pragma("page_size",{simple:true}) as number;
    return {pages,pageSize,logicalDatabaseBytes:pages*pageSize};
  })));

  return {
    generatedAt:new Date().toISOString(),seed,sourceClubCount,sourceFixtureCount,sourceDatabaseBytes,
    memoryBefore,samples,scalability,
    notes:[
      "All gameplay mutation samples run against disposable SQLite online-backup copies; the source save is not advanced.",
      "The single-match sample includes the real persistence path, including events, momentum, checkpoint, and player-condition writes.",
      "Scalability rows are CPU-only double-round-robin simulations using repeated source-club profiles; they do not measure 64/256-club data-package generation or database write amplification.",
      "better-sqlite3 statements are synchronous. synchronousBlockMs is the wall time during which the benchmark callback holds the main thread; eventLoopDelayMaxMs is a sampled histogram, not a hard real-time guarantee.",
      "The two-hour target applies to a representative campaign sample containing every scheduled league and cup stage; synthetic scale rows are engine-only. Compare repeated runs before setting CI performance budgets.",
    ],
  };
}
