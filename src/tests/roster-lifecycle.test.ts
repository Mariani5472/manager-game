import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, validateDatabase } from "../db/database.js";
import { SaveManager } from "../save/saveManager.js";
import {
  applyRosterSeason, createTransferOffer, ensureRosterLifecycleSchema, listClubFinances,
  listPlayerHistory, listRosterPlayers, listTransferHistory, respondToTransferOffer,
  renewPlayerContract,
} from "../game/rosterLifecycle.js";

const schemaPath=resolve("src/schema/game_manager_mvp.sql");

test("roster lifecycle develops players, generates youth, manages contracts and records transfers",async()=>{
  const root=mkdtempSync(join(tmpdir(),"manager-game-phase7-"));
  const masterPath=join(root,"master.sqlite");
  const master=openDatabase(masterPath);
  try{master.exec(readFileSync(schemaPath,"utf8"));validateDatabase(master);}finally{master.close();}
  const manager=new SaveManager(masterPath,join(root,"saves"));
  const save=await manager.create({name:"Phase 7 Test",managerName:"Test Manager",clubId:1});
  const db=manager.open(save.filePath);
  try{
    ensureRosterLifecycleSchema(db);
    const first=applyRosterSeason(db,2027);
    assert.ok(first.developed>0);
    assert.ok(first.youthGenerated>=16);
    assert.equal(applyRosterSeason(db,2027).youthGenerated,first.youthGenerated,"season processing must be idempotent");
    const roster=listRosterPlayers(db,2027);
    assert.ok(roster.some(p=>p.status==="YOUTH"));
    const finance=listClubFinances(db,1)[0] as {balance:number;transferBudget:number;weeklyWageBudget:number};
    assert.ok(finance.balance>0&&finance.transferBudget>0&&finance.weeklyWageBudget>0);

    const player=roster.find(p=>p.clubId===1&&p.age<30&&p.careerStatus==="ACTIVE");
    assert.ok(player,"factory squad should have a young active player");
    renewPlayerContract(db,player.playerId,1,0,3,2027);
    const offerId=createTransferOffer(db,player.playerId,2,1000,0,3,2027);
    respondToTransferOffer(db,offerId,"COUNTER",{fee:2000,weeklyWage:0,years:3},2027);
    respondToTransferOffer(db,offerId,"ACCEPT",undefined,2027);
    const moved=db.prepare("SELECT club_id AS clubId FROM squad_membership WHERE player_id=?").get(player.playerId) as {clubId:number};
    assert.equal(moved.clubId,2);
    assert.equal((db.prepare("SELECT status FROM transfer_negotiation WHERE id=?").get(offerId) as {status:string}).status,"COMPLETED");
    assert.ok(listTransferHistory(db,player.playerId).some(row=>row.type==="TRANSFER"));
    assert.ok(listPlayerHistory(db,player.playerId).length>0);
    validateDatabase(db);
  }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
