import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDatabase, validateDatabase } from "../db/database.js";
import { SaveManager } from "../save/saveManager.js";
import {
  applyPromotionRelegation, installDataPackage, listInstalledDataPackages,
  parseDataPackage, validateDataPackage,
} from "../game/dataPackages.js";

const schemaPath=resolve("src/schema/game_manager_mvp.sql");
const packagePath=resolve("data/packages/example-regional-leagues.json");

test("versioned data packages validate references, import generically and remain save-isolated",async()=>{
  const root=mkdtempSync(join(tmpdir(),"manager-game-phase8-"));
  const masterPath=join(root,"master.sqlite");
  const master=openDatabase(masterPath);
  try{master.exec(readFileSync(schemaPath,"utf8"));validateDatabase(master);}finally{master.close();}
  const manager=new SaveManager(masterPath,join(root,"saves"));
  const save=await manager.create({name:"Phase 8 Test",managerName:"Test Manager",clubId:1});
  const pkg=parseDataPackage(readFileSync(packagePath,"utf8"));
  const db=manager.open(save.filePath);
  try{
    assert.deepEqual(validateDataPackage(db,pkg),[]);
    const installed=installDataPackage(db,pkg);
    assert.equal(installed.packageId,"community.example-regional");
    assert.equal(installed.stages,4);
    assert.equal(installed.fixtures,8);
    assert.equal(installDataPackage(db,pkg).fixtures,0,"same package version must be idempotent");
    assert.equal(listInstalledDataPackages(db).length,1);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM data_package_entity WHERE package_id=? AND entity_type='club'").get(pkg.id) as {n:number}).n,4);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM player p JOIN person pe ON pe.id=p.person_id WHERE pe.full_name IN ('Davi Monteiro','Caio Ventura','Lucas Prado','Bruno Leme','Renan Vidal','Ícaro Reis','Mateus Serra','André Farias')").get() as {n:number}).n,8);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM fixture f JOIN competition_round r ON r.id=f.round_id JOIN competition_stage st ON st.id=r.stage_id JOIN competition_season cs ON cs.id=st.season_id WHERE cs.season_year=2026 AND f.status='SCHEDULED'").get() as {n:number}).n>=4,true);
    const invalid=parseDataPackage(readFileSync(packagePath,"utf8").replace('"clubCode": "NFC"','"clubCode": "MISSING-CLUB"'));
    assert.ok(validateDataPackage(db,invalid).some(message=>message.includes("MISSING-CLUB")));
    db.prepare("UPDATE competition_season SET status='COMPLETED' WHERE season_year=2026").run();
    const moved=applyPromotionRelegation(db,2026).movements;
    assert.equal(moved.length,2);
    const d1=(db.prepare("SELECT id FROM competition WHERE code='FIC-D1'").get() as {id:number}).id;
    const d2=(db.prepare("SELECT id FROM competition WHERE code='FIC-D2'").get() as {id:number}).id;
    const d1Next=(db.prepare("SELECT id FROM competition_stage st JOIN competition_season cs ON cs.id=st.season_id WHERE cs.competition_id=? AND cs.season_year=2027").get(d1) as {id:number}).id;
    const d2Next=(db.prepare("SELECT id FROM competition_stage st JOIN competition_season cs ON cs.id=st.season_id WHERE cs.competition_id=? AND cs.season_year=2027").get(d2) as {id:number}).id;
    const aurora=(db.prepare("SELECT local_id AS id FROM data_package_entity WHERE package_id=? AND entity_type='club' AND external_id='AUR'").get(pkg.id) as {id:number}).id;
    const porto=(db.prepare("SELECT local_id AS id FROM data_package_entity WHERE package_id=? AND entity_type='club' AND external_id='PSC'").get(pkg.id) as {id:number}).id;
    assert.ok(db.prepare("SELECT 1 FROM stage_participant WHERE stage_id=? AND club_id=?").get(d1Next,aurora),"promoted club enters the higher division");
    assert.ok(db.prepare("SELECT 1 FROM stage_participant WHERE stage_id=? AND club_id=?").get(d2Next,porto),"relegated club enters the lower division");
    assert.equal(db.prepare("SELECT 1 FROM stage_participant WHERE stage_id=? AND club_id=?").get(d2Next,aurora),undefined,"promoted club leaves the lower division");
    validateDatabase(db);
  }finally{db.close();}
  const untouchedMaster=openDatabase(masterPath,true);
  try{
    assert.equal(untouchedMaster.prepare("SELECT 1 FROM competition WHERE code='FIC-D1'").get(),undefined,"installing into a save must not mutate the master database");
  }finally{untouchedMaster.close();rmSync(root,{recursive:true,force:true});}
});
