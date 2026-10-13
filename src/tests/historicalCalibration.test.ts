import test from "node:test";
import assert from "node:assert/strict";
import { buildHistoricalCalibrationReport, parseHistoricalJsonl } from "../game/historicalCalibration.js";
import { runPersistedWorldBenchmarks } from "../game/persistedWorldBenchmark.js";
import { openDatabase } from "../db/database.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ensureFactoryWorld16 } from "../game/gameService.js";

const historical = [
  {date:"2022-01-01",competition:"League A",homeGoals:2,awayGoals:0,homeShots:10,awayShots:5,homeShotsOnTarget:4,awayShotsOnTarget:1,homeXg:1.4,awayXg:0.3},
  {date:"2022-02-01",competition:"League A",homeGoals:1,awayGoals:1,homeShots:8,awayShots:7,homeShotsOnTarget:2,awayShotsOnTarget:2,homeXg:0.8,awayXg:0.7},
  {date:"2024-01-01",competition:"League A",homeGoals:0,awayGoals:0,homeShots:4,awayShots:6,homeShotsOnTarget:1,awayShotsOnTarget:1},
  {date:"2024-02-01",competition:"League B",homeGoals:1,awayGoals:2,homeShots:9,awayShots:11,homeShotsOnTarget:3,awayShotsOnTarget:4},
];

test("historical calibration report keeps a chronological holdout and reports coverage",()=>{
  const report=buildHistoricalCalibrationReport(historical,{datasetVersion:"test-v1",splitDate:"2024-01-01",sha256:"abc"});
  assert.equal(report.dataset.matches,4);
  assert.deepEqual(report.dataset.competitions,["League A","League B"]);
  assert.equal(report.training.matches,2);
  assert.equal(report.validation.matches,2);
  assert.equal(report.validation.averageTotalGoals,1.5);
  assert.equal(report.validation.coverage.xg,0);
  assert.ok(report.warnings.some(w=>w.includes("lack paired xG")));
  assert.match(report.interpretation,/No engine coefficients were fitted/);
});
test("historical JSONL parser ignores comments and rejects malformed JSON",()=>{
  assert.equal(parseHistoricalJsonl("\n# source: export\n"+JSON.stringify(historical[0])+"\n").length,1);
  assert.throws(()=>parseHistoricalJsonl('{"date":'),/Invalid JSON/);
});
test("historical report rejects invalid split and inconsistent shot counts",()=>{
  assert.throws(()=>buildHistoricalCalibrationReport(historical,{datasetVersion:"v1",splitDate:"2022-01-01"}),/leave at least one match/);
  const invalid=[{...historical[0]!,homeShotsOnTarget:99},...historical.slice(1)];
  assert.throws(()=>buildHistoricalCalibrationReport(invalid,{datasetVersion:"v1",splitDate:"2024-01-01"}),/cannot exceed/);
});
test("persisted-world benchmark validates scale before opening disposable worlds",async()=>{
  const root=mkdtempSync(join(tmpdir(),"gm-world-scale-validation-"));
  const db=openDatabase(join(root,"campaign.sqlite"));
  try {
    db.exec(readFileSync(resolve("src/schema/game_manager_mvp.sql"),"utf8"));
    ensureFactoryWorld16(db);
    await assert.rejects(()=>runPersistedWorldBenchmarks(db,[17],1),/even integers/);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM club").get() as {n:number}).n,16);
  } finally {db.close();rmSync(root,{recursive:true,force:true});}
});
