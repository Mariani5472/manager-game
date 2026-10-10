import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, validateDatabase } from "../db/database.js";
import { SaveManager } from "../save/saveManager.js";
import {
  advanceNextFixture, advanceRound, getManagedClub, getSeasonStatus, getStandings,
  listFixtures, listSquad, getTactics, prepareNextLeagueSeason,
} from "../game/gameService.js";

const schemaText = readFileSync(resolve("src/schema/game_manager_mvp.sql"), "utf8");
function tempRoot(): string { return mkdtempSync(join(tmpdir(), "manager-game-season-")); }
function setup(root: string) {
  const master=join(root,"master.sqlite");
  const mdb=openDatabase(master);
  try { mdb.exec(schemaText); validateDatabase(mdb); } finally { mdb.close(); }
  const manager=new SaveManager(master,join(root,"saves"));
  const save=manager.create({name:"Season",managerName:"Coach",clubId:1});
  return {manager,save};
}

test("schema initializes and foreign keys are valid",()=>{
  const root=tempRoot(); try { const {manager,save}=setup(root); const db=manager.open(save.filePath);
    try { assert.equal(db.pragma("integrity_check",{simple:true}),"ok"); assert.deepEqual(db.pragma("foreign_key_check"),[]); }
    finally { db.close(); }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("services expose the managed club, squad and tactics",()=>{
  const root=tempRoot(); try { const {manager,save}=setup(root); const db=manager.open(save.filePath);
    try { assert.equal(getManagedClub(db).id,1); assert.equal(listSquad(db,1).length,18); assert.equal(getTactics(db,1).formation,"4-3-3"); }
    finally { db.close(); }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("advancing a round plays all AI and managed fixtures and rebuilds standings",()=>{
  const root=tempRoot(); try { const {manager,save}=setup(root); const db=manager.open(save.filePath);
    try {
      const results=advanceRound(db,1);
      assert.equal(results.length,2);
      const table=getStandings(db,1);
      assert.equal(table.reduce((sum,row)=>sum+row.played,0),4);
      assert.deepEqual([...table.map(row=>row.clubId)].sort((a,b)=>a-b),[1,2,3,4]);
      assert.ok(table.every(row=>row.played===1));
    } finally { db.close(); }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("completed fixture cannot be simulated again and leaves the first result intact",()=>{
  const root=tempRoot(); try { const {manager,save}=setup(root); const db=manager.open(save.filePath);
    try {
      const result=advanceNextFixture(db,1);
      const count=(db.prepare("SELECT COUNT(*) AS n FROM match_event WHERE fixture_id=1").get() as {n:number}).n;
      assert.throws(()=>advanceNextFixture(db,1),/Scheduled fixture/);
      assert.equal((db.prepare("SELECT home_score AS home,away_score AS away FROM fixture WHERE id=1").get() as {home:number;away:number}).home,result.homeScore);
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM match_event WHERE fixture_id=1").get() as {n:number}).n,count);
    } finally { db.close(); }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("a full configured league season completes, survives reopening, and next season is idempotent",()=>{
  const root=tempRoot(); try { const {manager,save}=setup(root); let db=manager.open(save.filePath);
    try {
      const initialLeagueFixtures=listFixtures(db).filter(f=>f.competition==="Liga Nacional de Teste");
      assert.equal(initialLeagueFixtures.length,4);
      const rounds=db.prepare("SELECT id FROM competition_round WHERE stage_id=1 ORDER BY round_number").all() as Array<{id:number}>;
      for(const round of rounds) advanceRound(db,round.id);
      assert.equal(getSeasonStatus(db,1)[0]?.seasonStatus,"COMPLETED");
      assert.equal(getSeasonStatus(db,1)[0]?.stageStatus,"COMPLETED");
      const standings=getStandings(db,1);
      assert.ok(standings.every(r=>r.played===2));
      db.close();
      db=manager.open(save.filePath);
      assert.equal(getSeasonStatus(db,1)[0]?.seasonStatus,"COMPLETED");
      const next=prepareNextLeagueSeason(db,1);
      assert.equal(next.fixtures,12);
      assert.deepEqual(prepareNextLeagueSeason(db,1),next);
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM competition_season WHERE competition_id=1").get() as {n:number}).n,2);
    } finally { if(db.open) db.close(); }
  } finally { rmSync(root,{recursive:true,force:true}); }
});
