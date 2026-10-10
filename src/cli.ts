import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDatabase, validateDatabase } from "./db/database.js";
import { SaveManager } from "./save/saveManager.js";
import {
  advanceNextFixture, advanceRound, getManagedClub, getSeasonStatus, getStandings,
  listClubs, listFixtures, listSquad, getTactics, prepareNextLeagueSeason,
} from "./game/gameService.js";

const root=process.cwd();
const masterPath=resolve(process.env.GMF_MASTER_DB ?? joinPath(root,"data/master.sqlite"));
const savesDir=resolve(process.env.GMF_SAVES_DIR ?? joinPath(root,"data/saves"));
const schemaPath=resolve(process.env.GMF_SCHEMA_SQL ?? joinPath(root,"src/schema/game_manager_mvp.sql"));
function joinPath(a:string,b:string):string{return a.endsWith("/")?a+b:a+"/"+b;}

function initializeMaster():void{
  if(existsSync(masterPath)){console.log(`Master DB already exists: ${masterPath}`);return;}
  mkdirSync(dirname(masterPath),{recursive:true});
  const db=openDatabase(masterPath);
  try{db.exec(readFileSync(schemaPath,"utf8"));validateDatabase(db);console.log(`Master DB created: ${masterPath}`);}
  catch(error){db.close();throw error;}
  finally{if(db.open)db.close();}
}
function parseOption(args:string[],key:string):string|undefined{
  const i=args.indexOf(key);if(i<0)return undefined;const value=args[i+1];
  if(!value||value.startsWith("--"))throw new Error(`Option ${key} requires a value.`);return value;
}
function withSave<T>(args:string[],fn:(db:ReturnType<typeof openDatabase>)=>T):T{
  const id=parseOption(args,"--save-id"),path=parseOption(args,"--save");
  if(id&&path)throw new Error("Use either --save-id or --save, not both.");
  if(!id&&!path)throw new Error("Provide --save-id <save-id> or --save <path>.");
  const manager=new SaveManager(masterPath,savesDir),db=id?manager.openById(id):manager.open(path!);
  try{return fn(db);}finally{db.close();}
}
function main():void{
 const [cmd,...args]=process.argv.slice(2);
 switch(cmd){
  case "init-master":initializeMaster();return;
  case "clubs":{if(!existsSync(masterPath))throw new Error('Run "npm run dev -- init-master" first.');
   const db=openDatabase(masterPath,true);try{validateDatabase(db);console.table(listClubs(db));}finally{db.close();}return;}
  case "new-save":{
   const name=parseOption(args,"--name"),manager=parseOption(args,"--manager"),raw=parseOption(args,"--club");
   if(!name||!manager||!raw)throw new Error("Required: --name, --manager and --club.");
   const clubId=Number(raw);if(!Number.isSafeInteger(clubId)||clubId<=0)throw new Error("--club must be a positive integer.");
   console.log(JSON.stringify(new SaveManager(masterPath,savesDir).create({name,managerName:manager,clubId}),null,2));return;}
  case "saves":console.table(new SaveManager(masterPath,savesDir).list());return;
  case "club":withSave(args,db=>console.table([getManagedClub(db)]));return;
  case "squad":withSave(args,db=>console.table(listSquad(db,Number(parseOption(args,"--club")??getManagedClub(db).id))));return;
  case "tactics":withSave(args,db=>console.table([getTactics(db,Number(parseOption(args,"--club")??getManagedClub(db).id)]));return;
  case "fixtures":withSave(args,db=>console.table(listFixtures(db,args.includes("--pending"))));return;
  case "standings":withSave(args,db=>console.table(getStandings(db,Number(parseOption(args,"--stage")??"1"))));return;
  case "season-status":withSave(args,db=>console.table(getSeasonStatus(db)));return;
  case "play":{
   const raw=args.find(v=>!v.startsWith("--"));const id=raw===undefined?undefined:Number(raw);
   if(id!==undefined&&(!Number.isSafeInteger(id)||id<=0))throw new Error("Fixture ID must be a positive integer.");
   withSave(args,db=>console.table([advanceNextFixture(db,id)]));return;}
  case "advance-round":{
   const raw=args.find(v=>!v.startsWith("--")),id=Number(raw);
   if(!Number.isSafeInteger(id)||id<=0)throw new Error("Round ID must be a positive integer.");
   withSave(args,db=>console.table(advanceRound(db,id)));return;}
  case "next-season":{
   const stage=Number(parseOption(args,"--stage")??"1");
   if(!Number.isSafeInteger(stage)||stage<=0)throw new Error("Stage ID must be a positive integer.");
   withSave(args,db=>console.table([prepareNextLeagueSeason(db,stage)]));return;}
  default:console.log("Commands: init-master, clubs, new-save, saves, club, squad, tactics, fixtures, play, advance-round, standings, season-status, next-season");
 }
}
if(import.meta.url===pathToFileURL(process.argv[1]??"").href){try{main();}catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}}
