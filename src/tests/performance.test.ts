import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, validateDatabase } from "../db/database.js";
import { ensureFactoryWorld16 } from "../game/gameService.js";
import { runEngineDiagnostics, runMatchBalanceAnalysis, runSyntheticSeasonScaleBenchmarks, runTacticalSensitivityAnalysis } from "../game/matchEngine.js";
import { runPerformanceBenchmark } from "../game/performance.js";

const schemaPath=resolve("src/schema/game_manager_mvp.sql");
function fixtureDb():{root:string;db:ReturnType<typeof openDatabase>} {
  const root=mkdtempSync(join(tmpdir(),"gm-p0-performance-"));
  const db=openDatabase(join(root,"campaign.sqlite"));
  db.exec(readFileSync(schemaPath,"utf8"));
  ensureFactoryWorld16(db);
  validateDatabase(db);
  return {root,db};
}

test("Monte Carlo diagnostics expose reproducible Wilson confidence intervals",()=>{
  const {root,db}=fixtureDb();
  try {
    const first=runEngineDiagnostics(db,200,918273);
    const second=runEngineDiagnostics(db,200,918273);
    assert.deepEqual(first.baseline,second.baseline);
    assert.equal(first.statisticalAcceptance.method,"Wilson score interval");
    assert.equal(first.statisticalAcceptance.outcomeRatesPartition,true);
    for(const interval of Object.values(first.statisticalAcceptance.outcomes)) {
      assert.ok(interval.lower<=interval.estimate);
      assert.ok(interval.estimate<=interval.upper);
      assert.equal(interval.trials,200);
      assert.equal(interval.confidenceLevel,0.95);
    }
    assert.match(first.statisticalAcceptance.interpretation,/not empirical football-calibration targets/);
  } finally { db.close(); rmSync(root,{recursive:true,force:true}); }
});

test("engine scalability benchmarks reproduce double-round-robin match counts",()=>{
  const {root,db}=fixtureDb();
  try {
    const first=runSyntheticSeasonScaleBenchmarks(db,[16,64],24680);
    const second=runSyntheticSeasonScaleBenchmarks(db,[16,64],24680);
    assert.deepEqual(first.map(row=>({clubs:row.clubs,matches:row.matches,seed:row.seed,averageGoalsPerMatch:row.averageGoalsPerMatch,drawRate:row.drawRate})),
      second.map(row=>({clubs:row.clubs,matches:row.matches,seed:row.seed,averageGoalsPerMatch:row.averageGoalsPerMatch,drawRate:row.drawRate})));
    assert.deepEqual(first.map(row=>[row.clubs,row.matches]),[[16,240],[64,4032]]);
    assert.ok(first.every(row=>Number.isFinite(row.durationMs)&&row.durationMs>=0&&row.matchesPerSecond>0));
  } finally { db.close(); rmSync(root,{recursive:true,force:true}); }
});

test("one-variable-at-a-time sensitivity report covers tactics and match context without mutating the save",()=>{
  const {root,db}=fixtureDb();
  try {
    const before=db.prepare("SELECT pressing,tempo,width,passing_directness FROM team_tactic WHERE club_id=1").get();
    const report=runTacticalSensitivityAnalysis(db,1,2,150,112233);
    const after=db.prepare("SELECT pressing,tempo,width,passing_directness FROM team_tactic WHERE club_id=1").get();
    assert.deepEqual(after,before);
    assert.ok(report.scenarios.some(row=>row.changedVariable==="pressing"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="width"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="passing_directness"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="energy"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="morale"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="sharpness"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="weather"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="pitch"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="rest"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="travel"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="goalkeeper attributes"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="individual finishing"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="individual defensive attributes"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="player role"));
    assert.ok(report.scenarios.some(row=>row.changedVariable==="formation"));
    assert.ok(report.scenarios.every(row=>Number.isFinite(row.homeWinRateDelta)&&Number.isFinite(row.homeShotsDelta)));
  } finally { db.close(); rmSync(root,{recursive:true,force:true}); }
});

test("performance harness measures representative operations on disposable copies",async()=>{
  const {root,db}=fixtureDb();
  try {
    const before=db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE status='COMPLETED'").get() as {count:number};
    const report=await runPerformanceBenchmark(db,{seed:777,scales:[16],includeSeason:true});
    const after=db.prepare("SELECT COUNT(*) AS count FROM fixture WHERE status='COMPLETED'").get() as {count:number};
    assert.equal(after.count,before.count,"benchmark must not mutate the source campaign");
    assert.equal(report.seed,777);
    assert.equal(report.sourceClubCount,16);
    assert.ok(report.samples.some(sample=>sample.name==="singleMatchAndPersistence"));
    assert.ok(report.samples.some(sample=>sample.name==="roundAndStandings"));
    const seasonSample=report.samples.find(sample=>sample.name==="completeLeagueSeason");
    assert.ok(seasonSample);
    assert.equal((seasonSample.details as {fixtures:number}).fixtures,240);
    assert.ok(report.samples.some(sample=>sample.name==="playerEvolution"));
    assert.ok(report.samples.some(sample=>sample.name==="transferMarketOffer"));
    assert.ok(report.samples.some(sample=>sample.name==="sqliteValidationAndPersistence"));
    assert.ok(report.samples.every(sample=>sample.durationMs>=0&&sample.sqlQueryCount>=0&&sample.databaseBytes>=0));
    assert.deepEqual(report.scalability.map(row=>row.clubs),[16]);
  } finally { db.close(); rmSync(root,{recursive:true,force:true}); }
});

test("match balance results are reproducible across repeated seeds",()=>{
  const {root,db}=fixtureDb();
  try {
    assert.deepEqual(runMatchBalanceAnalysis(db,1,2,250,98765),runMatchBalanceAnalysis(db,1,2,250,98765));
    assert.deepEqual(runMatchBalanceAnalysis(db,1,2,250,98765),runMatchBalanceAnalysis(db,1,2,250,98765));
  } finally { db.close(); rmSync(root,{recursive:true,force:true}); }
});
