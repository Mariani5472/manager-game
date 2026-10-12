import type { SqliteDatabase } from "../db/database.js";

const ATTRIBUTE_COLUMNS = [
  "pace","acceleration","stamina","strength","agility","positioning","anticipation","decisions",
  "composure","teamwork","work_rate","passing","vision","crossing","dribbling","finishing",
  "long_shots","heading","tackling","marking","aggression","concentration","reflexes","handling","aerial_reach",
] as const;
const POSITION_CODES = ["GK","CB","LB","RB","DM","CM","AM","LW","RW","ST"] as const;
const FIRST_NAMES = ["Alex","Bruno","Caio","Daniel","Enzo","Felipe","Gabriel","Hugo","Ian","João","Kai","Lucas","Mateus","Nicolas","Otávio","Pedro","Rafael","Samuel","Theo","Vitor"];
const LAST_NAMES = ["Almeida","Barbosa","Costa","Dias","Esteves","Ferreira","Gomes","Henrique","Ibrahim","Júnior","Lima","Mendes","Nunes","Oliveira","Pereira","Queiroz","Ribeiro","Silva","Teixeira","Vieira"];

export function ensureRosterLifecycleSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS club_finance (
      club_id INTEGER PRIMARY KEY REFERENCES club(id) ON DELETE CASCADE,
      balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
      transfer_budget INTEGER NOT NULL DEFAULT 0 CHECK(transfer_budget >= 0),
      weekly_wage_budget INTEGER NOT NULL DEFAULT 0 CHECK(weekly_wage_budget >= 0),
      last_processed_season INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS player_contract (
      player_id INTEGER PRIMARY KEY REFERENCES player(person_id) ON DELETE CASCADE,
      club_id INTEGER REFERENCES club(id),
      start_season INTEGER NOT NULL,
      end_season INTEGER NOT NULL,
      weekly_wage INTEGER NOT NULL DEFAULT 0 CHECK(weekly_wage >= 0),
      release_clause INTEGER CHECK(release_clause IS NULL OR release_clause >= 0),
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','EXPIRED','TERMINATED')),
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(end_season >= start_season)
    );
    CREATE INDEX IF NOT EXISTS idx_player_contract_club_status ON player_contract(club_id,status);
    CREATE TABLE IF NOT EXISTS player_lifecycle (
      player_id INTEGER PRIMARY KEY REFERENCES player(person_id) ON DELETE CASCADE,
      career_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(career_status IN ('ACTIVE','RETIRED')),
      retired_at_season INTEGER,
      last_processed_season INTEGER NOT NULL DEFAULT 0,
      development_points INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS transfer_negotiation (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES player(person_id),
      selling_club_id INTEGER REFERENCES club(id),
      buying_club_id INTEGER NOT NULL REFERENCES club(id),
      offer_fee INTEGER NOT NULL CHECK(offer_fee >= 0),
      offered_weekly_wage INTEGER NOT NULL CHECK(offered_weekly_wage >= 0),
      contract_years INTEGER NOT NULL CHECK(contract_years BETWEEN 1 AND 5),
      status TEXT NOT NULL CHECK(status IN ('OPEN','COUNTERED','REJECTED','COMPLETED')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      last_message TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_transfer_negotiation_status ON transfer_negotiation(status,buying_club_id);
    CREATE TABLE IF NOT EXISTS transfer_history (
      id INTEGER PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES player(person_id),
      from_club_id INTEGER REFERENCES club(id),
      to_club_id INTEGER REFERENCES club(id),
      fee INTEGER NOT NULL DEFAULT 0,
      season_year INTEGER NOT NULL,
      transfer_type TEXT NOT NULL CHECK(transfer_type IN ('TRANSFER','FREE_AGENT','ACADEMY','RETIREMENT','CONTRACT_EXPIRED')),
      details TEXT NOT NULL DEFAULT '',
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS player_season_history (
      player_id INTEGER NOT NULL REFERENCES player(person_id),
      season_year INTEGER NOT NULL,
      club_id INTEGER REFERENCES club(id),
      age INTEGER NOT NULL,
      overall_rating INTEGER NOT NULL,
      potential INTEGER NOT NULL,
      weekly_wage INTEGER NOT NULL DEFAULT 0,
      appearances INTEGER NOT NULL DEFAULT 0,
      minutes_played INTEGER NOT NULL DEFAULT 0,
      goals INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      PRIMARY KEY(player_id,season_year)
    );
    CREATE TABLE IF NOT EXISTS club_season_history (
      club_id INTEGER NOT NULL REFERENCES club(id),
      season_year INTEGER NOT NULL,
      balance INTEGER NOT NULL,
      transfer_budget INTEGER NOT NULL,
      wage_bill_weekly INTEGER NOT NULL,
      squad_size INTEGER NOT NULL,
      youth_promoted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(club_id,season_year)
    );
    CREATE TABLE IF NOT EXISTS roster_season_run (
      season_year INTEGER PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      players_developed INTEGER NOT NULL DEFAULT 0,
      players_retired INTEGER NOT NULL DEFAULT 0,
      youth_generated INTEGER NOT NULL DEFAULT 0
    );
  `);
  const clubs = db.prepare("SELECT id,reputation FROM club").all() as Array<{id:number;reputation:number}>;
  const finance = db.prepare("INSERT OR IGNORE INTO club_finance(club_id,balance,transfer_budget,weekly_wage_budget) VALUES(?,?,?,?)");
  for (const club of clubs) {
    const rep = Math.max(10,club.reputation);
    finance.run(club.id, 1_000_000 + rep*150_000, 250_000 + rep*18_000, 8_000 + rep*350);
  }
  db.prepare("INSERT OR IGNORE INTO player_lifecycle(player_id) SELECT person_id FROM player").run();
  const contractRows = db.prepare(`
    SELECT sm.player_id AS playerId,sm.club_id AS clubId,COALESCE(cs.season_year,2026) AS year,
      COALESCE(pa.pace+pa.passing+pa.finishing+pa.tackling+pa.positioning,250)/5 AS rating,
      p.potential
    FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id
    JOIN player_attribute pa ON pa.player_id=p.person_id
    LEFT JOIN (SELECT MAX(season_year) season_year FROM competition_season) cs ON 1=1
  `).all() as Array<{playerId:number;clubId:number;year:number;rating:number;potential:number}>;
  const contract = db.prepare("INSERT OR IGNORE INTO player_contract(player_id,club_id,start_season,end_season,weekly_wage,status) VALUES(?,?,?,?,?,'ACTIVE')");
  for (const player of contractRows) contract.run(player.playerId,player.clubId,player.year,player.year+2,Math.max(250,Math.round((player.rating*player.rating/10)+player.potential*12)));
}

function random01(seed:number):number {
  let x=seed>>>0; x+=0x6D2B79F5; let t=x;
  t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61);
  return ((t^(t>>>14))>>>0)/4294967296;
}
function clamp(value:number,min:number,max:number):number { return Math.max(min,Math.min(max,Math.round(value))); }
function ageAt(birthDate:string|null,year:number):number { return birthDate ? Math.max(0,year-Number(birthDate.slice(0,4))) : 24; }
function overallRating(db:SqliteDatabase,playerId:number):number {
  const row=db.prepare("SELECT "+ATTRIBUTE_COLUMNS.join(",")+" FROM player_attribute WHERE player_id=?").get(playerId) as Record<string,number>|undefined;
  if(!row)return 35;
  const vals=ATTRIBUTE_COLUMNS.map(key=>Number(row[key] ?? 0));
  return Math.round(vals.reduce((a,b)=>a+b,0)/vals.length);
}
function marketValue(rating:number,potential:number,age:number):number {
  const ageFactor=age<20?1.55:age<24?1.35:age<29?1:age<32?.65:.32;
  return Math.max(10_000,Math.round((rating*rating*350 + potential*potential*65)*ageFactor));
}
function seasonYearForPlayer(db:SqliteDatabase):number {
  const row=db.prepare("SELECT MAX(season_year) AS year FROM competition_season").get() as {year:number|null};
  return row.year ?? 2026;
}

export interface RosterSeasonResult {seasonYear:number;developed:number;retired:number;youthGenerated:number;contractsExpired:number;}
export function applyRosterSeason(db:SqliteDatabase,seasonYear:number):RosterSeasonResult {
  ensureRosterLifecycleSchema(db);
  const done=db.prepare("SELECT players_developed AS developed,players_retired AS retired,youth_generated AS youthGenerated FROM roster_season_run WHERE season_year=?").get(seasonYear) as {developed:number;retired:number;youthGenerated:number}|undefined;
  if(done) return {seasonYear,...done,contractsExpired:0};
  let developed=0,retired=0,youthGenerated=0,contractsExpired=0;
  const transaction=db.transaction(()=>{
    const players=db.prepare(`
      SELECT p.person_id AS id,p.potential AS potential,pe.birth_date AS birthDate,sm.club_id AS clubId,
        COALESCE(pc.energy,100) AS energy,COALESCE(l.career_status,'ACTIVE') AS careerStatus,
        COALESCE(l.last_processed_season,0) AS lastSeason,COALESCE(c.weekly_wage,0) AS wage
      FROM player p JOIN person pe ON pe.id=p.person_id
      LEFT JOIN squad_membership sm ON sm.player_id=p.person_id
      LEFT JOIN player_condition pc ON pc.player_id=p.person_id
      LEFT JOIN player_lifecycle l ON l.player_id=p.person_id
      LEFT JOIN player_contract c ON c.player_id=p.person_id
      WHERE COALESCE(l.career_status,'ACTIVE')='ACTIVE'
    `).all() as Array<{id:number;potential:number;birthDate:string|null;clubId:number|null;energy:number;careerStatus:string;lastSeason:number;wage:number}>;
    const attributeUpdate=db.prepare("UPDATE player_attribute SET "+ATTRIBUTE_COLUMNS.map(key=>key+"=?").join(",")+" WHERE player_id=?");
    const updatePlayer=db.prepare("UPDATE player SET potential=? WHERE person_id=?");
    const updateLife=db.prepare("UPDATE player_lifecycle SET last_processed_season=?,development_points=development_points+? WHERE player_id=?");
    const history=db.prepare(`INSERT OR IGNORE INTO player_season_history(player_id,season_year,club_id,age,overall_rating,potential,weekly_wage,appearances,minutes_played,goals,status)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    for(const p of players) {
      if(p.lastSeason>=seasonYear) continue;
      const age=ageAt(p.birthDate,seasonYear);
      const rating=overallRating(db,p.id);
      const growth=age<=20?Math.max(0,(p.potential-rating)/18):age<=24?Math.max(0,(p.potential-rating)/35):age<=28?0:-Math.max(0,age-28)*.22;
      const training=clamp(growth+(p.energy<45?-.45:0)+(random01(p.id*31+seasonYear*7919)-.5)*1.5,-2,2);
      const attrs=db.prepare("SELECT "+ATTRIBUTE_COLUMNS.join(",")+" FROM player_attribute WHERE player_id=?").get(p.id) as Record<string,number>|undefined;
      if(attrs) {
        const values=ATTRIBUTE_COLUMNS.map((key,index)=>{
          const physical=["pace","acceleration","agility","stamina","strength"].includes(key);
          const delta=physical&&age>=30?-Math.max(0,(age-29)*.15):training;
          return clamp(Number(attrs[key])+delta,1,99);
        });
        attributeUpdate.run(...values,p.id);
      }
      let potential=p.potential;
      if(age<=20&&rating>=potential-3&&random01(p.id+seasonYear*137)>.45) potential=clamp(potential+1,1,100);
      if(age>=31&&random01(p.id+seasonYear*313)>.65) potential=clamp(potential-1,1,100);
      updatePlayer.run(potential,p.id);
      updateLife.run(seasonYear,Math.max(0,training),p.id);
      const appearances=db.prepare("SELECT COUNT(DISTINCT fixture_id) AS n,COALESCE(SUM(minutes_played),0) AS minutes FROM match_player_state WHERE player_id=? AND fixture_id IN (SELECT id FROM fixture WHERE substr(scheduled_at,1,4)=?)").get(p.id,String(seasonYear)) as {n:number;minutes:number};
      const goals=db.prepare("SELECT COUNT(*) AS n FROM match_event WHERE player_id=? AND event_type='GOAL' AND fixture_id IN (SELECT id FROM fixture WHERE substr(scheduled_at,1,4)=?)").get(p.id,String(seasonYear)) as {n:number};
      history.run(p.id,seasonYear,p.clubId,age,overallRating(db,p.id),potential,p.wage,appearances.n,appearances.minutes,goals.n,"ACTIVE");
      developed++;
      if(age>=36&&random01(p.id+seasonYear*997)>(age>=40?.15:age>=38?.35:.72)) {
        db.prepare("UPDATE player_lifecycle SET career_status='RETIRED',retired_at_season=? WHERE player_id=?").run(seasonYear,p.id);
        db.prepare("DELETE FROM squad_membership WHERE player_id=?").run(p.id);
        db.prepare("UPDATE player_contract SET status='TERMINATED',club_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE player_id=?").run(p.id);
        db.prepare("INSERT INTO transfer_history(player_id,from_club_id,to_club_id,fee,season_year,transfer_type,details) VALUES(?,?,NULL,0,?,'RETIREMENT','Aposentadoria automática')").run(p.id,p.clubId,seasonYear);
        retired++;
      }
    }
    const expired=db.prepare("SELECT player_id AS playerId,club_id AS clubId FROM player_contract WHERE status='ACTIVE' AND end_season<?").all(seasonYear) as Array<{playerId:number;clubId:number|null}>;
    for(const contract of expired) {
      db.prepare("UPDATE player_contract SET status='EXPIRED',club_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE player_id=?").run(contract.playerId);
      db.prepare("DELETE FROM squad_membership WHERE player_id=?").run(contract.playerId);
      if(contract.clubId!==null) db.prepare("INSERT INTO transfer_history(player_id,from_club_id,to_club_id,fee,season_year,transfer_type,details) VALUES(?,?,NULL,0,?,'CONTRACT_EXPIRED','Contrato expirado; jogador livre')").run(contract.playerId,contract.clubId,seasonYear);
      contractsExpired++;
    }
    const clubs=db.prepare("SELECT id,reputation,nation_id AS nationId FROM club ORDER BY id").all() as Array<{id:number;reputation:number;nationId:number}>;
    for(const club of clubs) {
      const wageBill=(db.prepare("SELECT COALESCE(SUM(weekly_wage),0) AS value FROM player_contract WHERE club_id=? AND status='ACTIVE'").get(club.id) as {value:number}).value;
      const finance=db.prepare("SELECT balance,transfer_budget,weekly_wage_budget,last_processed_season AS lastSeason FROM club_finance WHERE club_id=?").get(club.id) as {balance:number;transfer_budget:number;weekly_wage_budget:number;lastSeason:number};
      const balance=Math.max(0,finance.balance-wageBill*52);
      const transferBudget=Math.min(balance,Math.max(0,finance.transfer_budget+Math.round(club.reputation*7_500)-Math.round(wageBill*8)));
      db.prepare("UPDATE club_finance SET balance=?,transfer_budget=?,last_processed_season=? WHERE club_id=?").run(balance,transferBudget,seasonYear,club.id);
      const clubPlayers=db.prepare("SELECT COUNT(*) AS n FROM squad_membership WHERE club_id=?").get(club.id) as {n:number};
      db.prepare("INSERT OR IGNORE INTO club_season_history(club_id,season_year,balance,transfer_budget,wage_bill_weekly,squad_size,youth_promoted) VALUES(?,?,?,?,?,?,0)").run(club.id,seasonYear,balance,transferBudget,wageBill,clubPlayers.n);
      const youthCount=db.prepare("SELECT COUNT(*) AS n FROM squad_membership WHERE club_id=? AND squad_status='YOUTH'").get(club.id) as {n:number};
      const intakeCount=youthCount.n<4?2:1;
      for(let i=0;i<intakeCount;i++) {
        const seed=seasonYear*100003+club.id*97+i*31;
        const first=FIRST_NAMES[Math.floor(random01(seed)*FIRST_NAMES.length)]!;
        const last=LAST_NAMES[Math.floor(random01(seed+17)*LAST_NAMES.length)]!;
        const birthYear=seasonYear-(16+Math.floor(random01(seed+29)*3));
        const personId=Number(db.prepare("INSERT INTO person(full_name,birth_date,nationality_id) VALUES(?,?,?)").run(`${first} ${last} ${club.nationId}`,`${birthYear}-07-01`,club.nationId).lastInsertRowid);
        const potential=clamp(40+club.reputation*.35+random01(seed+41)*24,35,90);
        db.prepare("INSERT INTO player(person_id,potential,preferred_foot,goalkeeper) VALUES(?,?,?,?)").run(personId,potential,random01(seed+53)<.1?"LEFT":"RIGHT",random01(seed+67)<.1?1:0);
        const rating=clamp(25+club.reputation*.3+random01(seed+71)*18,20,65);
        db.prepare("INSERT INTO player_attribute(player_id,"+ATTRIBUTE_COLUMNS.join(",")+") VALUES("+ATTRIBUTE_COLUMNS.map(()=>"?").join(",")+")").run(personId,...ATTRIBUTE_COLUMNS.map((_,index)=>clamp(rating+(random01(seed+index*19)-.5)*16,10,80)));
        const primary=POSITION_CODES[Math.floor(random01(seed+79)*POSITION_CODES.length)]!;
        const secondary=POSITION_CODES[(POSITION_CODES.indexOf(primary)+3)%POSITION_CODES.length]!;
        db.prepare("INSERT INTO player_position(player_id,position_code,rating) VALUES(?,?,?),(?,?,?)").run(personId,primary,rating,personId,secondary,Math.max(20,rating-8));
        db.prepare("INSERT INTO player_condition(player_id) VALUES(?)").run(personId);
        db.prepare("INSERT INTO squad_membership(player_id,club_id,shirt_number,squad_status) VALUES(?,?,?, 'YOUTH')").run(personId,club.id,null);
        db.prepare("INSERT INTO player_lifecycle(player_id,last_processed_season) VALUES(?,?)").run(personId,seasonYear);
        db.prepare("INSERT INTO player_contract(player_id,club_id,start_season,end_season,weekly_wage,status) VALUES(?,?,?,?,?,'ACTIVE')").run(personId,club.id,seasonYear,seasonYear+3,250+Math.round(rating*8));
        db.prepare("INSERT INTO transfer_history(player_id,from_club_id,to_club_id,fee,season_year,transfer_type,details) VALUES(?,NULL,?,0,?,'ACADEMY','Formado na base')").run(personId,club.id,seasonYear);
        youthGenerated++;
      }
    }
    db.prepare("INSERT INTO roster_season_run(season_year,players_developed,players_retired,youth_generated) VALUES(?,?,?,?)").run(seasonYear,developed,retired,youthGenerated);
  });
  transaction();
  return {seasonYear,developed,retired,youthGenerated,contractsExpired};
}

export interface RosterPlayerRow {
  playerId:number;name:string;age:number;clubId:number|null;club:string|null;overall:number;potential:number;
  weeklyWage:number;contractEnd:number|null;marketValue:number;status:string;careerStatus:string;
}
export function listRosterPlayers(db:SqliteDatabase,seasonYear=seasonYearForPlayer(db),clubId?:number):RosterPlayerRow[] {
  ensureRosterLifecycleSchema(db);
  const rows=db.prepare(`
    SELECT p.person_id AS playerId,pe.full_name AS name,pe.birth_date AS birthDate,sm.club_id AS clubId,c.name AS club,
      p.potential AS potential,COALESCE(pc.weekly_wage,0) AS weeklyWage,pc.end_season AS contractEnd,
      COALESCE(sm.squad_status,'FREE_AGENT') AS status,COALESCE(l.career_status,'ACTIVE') AS careerStatus
    FROM player p JOIN person pe ON pe.id=p.person_id
    LEFT JOIN squad_membership sm ON sm.player_id=p.person_id
    LEFT JOIN club c ON c.id=sm.club_id
    LEFT JOIN player_contract pc ON pc.player_id=p.person_id
    LEFT JOIN player_lifecycle l ON l.player_id=p.person_id
    WHERE COALESCE(l.career_status,'ACTIVE')='ACTIVE' AND (? IS NULL OR sm.club_id=?)
    ORDER BY sm.club_id,pe.full_name
  `).all(clubId??null,clubId??null) as Array<{playerId:number;name:string;birthDate:string|null;clubId:number|null;club:string|null;potential:number;weeklyWage:number;contractEnd:number|null;status:string;careerStatus:string}>;
  return rows.map(row=>{const age=ageAt(row.birthDate,seasonYear);const overall=overallRating(db,row.playerId);return {...row,age,overall,marketValue:marketValue(overall,row.potential,age)};});
}

export function renewPlayerContract(db:SqliteDatabase,playerId:number,clubId:number,weeklyWage:number,years:number,seasonYear=seasonYearForPlayer(db)):void {
  ensureRosterLifecycleSchema(db);
  if(!Number.isSafeInteger(weeklyWage)||weeklyWage<0)throw new Error("Weekly wage must be a non-negative integer.");
  if(!Number.isSafeInteger(years)||years<1||years>5)throw new Error("Contract duration must be 1–5 seasons.");
  const membership=db.prepare("SELECT 1 FROM squad_membership WHERE player_id=? AND club_id=?").get(playerId,clubId);
  if(!membership)throw new Error("Player must currently belong to this club to renew a contract.");
  const finance=db.prepare("SELECT weekly_wage_budget AS budget FROM club_finance WHERE club_id=?").get(clubId) as {budget:number};
  const current=(db.prepare("SELECT COALESCE(SUM(weekly_wage),0) AS wage FROM player_contract WHERE club_id=? AND status='ACTIVE' AND player_id<>?").get(clubId,playerId) as {wage:number}).wage;
  if(current+weeklyWage>finance.budget)throw new Error("Weekly wage budget exceeded.");
  db.prepare(`INSERT INTO player_contract(player_id,club_id,start_season,end_season,weekly_wage,status)
    VALUES(?,?,?,?,?,'ACTIVE') ON CONFLICT(player_id) DO UPDATE SET club_id=excluded.club_id,start_season=excluded.start_season,end_season=excluded.end_season,weekly_wage=excluded.weekly_wage,status='ACTIVE',updated_at=CURRENT_TIMESTAMP`)
    .run(playerId,clubId,seasonYear,seasonYear+years-1,weeklyWage);
}

export function createTransferOffer(db:SqliteDatabase,playerId:number,buyingClubId:number,fee:number,weeklyWage:number,years:number,seasonYear=seasonYearForPlayer(db)):number {
  ensureRosterLifecycleSchema(db);
  if(!Number.isSafeInteger(fee)||fee<0)throw new Error("Transfer fee must be a non-negative integer.");
  if(!Number.isSafeInteger(weeklyWage)||weeklyWage<0)throw new Error("Weekly wage must be a non-negative integer.");
  if(!Number.isSafeInteger(years)||years<1||years>5)throw new Error("Contract duration must be 1–5 seasons.");
  const player=db.prepare(`SELECT sm.club_id AS clubId,COALESCE(l.career_status,'ACTIVE') AS careerStatus
    FROM player p LEFT JOIN squad_membership sm ON sm.player_id=p.person_id LEFT JOIN player_lifecycle l ON l.player_id=p.person_id
    WHERE p.person_id=?`).get(playerId) as {clubId:number|null;careerStatus:string}|undefined;
  if(!player||player.careerStatus!=="ACTIVE")throw new Error("Player not found or already retired.");
  if(player.clubId===buyingClubId)throw new Error("Club cannot sign its own player through the transfer market.");
  const buying=db.prepare("SELECT balance,transfer_budget,weekly_wage_budget FROM club_finance WHERE club_id=?").get(buyingClubId) as {balance:number;transfer_budget:number;weekly_wage_budget:number}|undefined;
  if(!buying)throw new Error("Buying club not found.");
  const currentWages=(db.prepare("SELECT COALESCE(SUM(weekly_wage),0) AS wage FROM player_contract WHERE club_id=? AND status='ACTIVE'").get(buyingClubId) as {wage:number}).wage;
  if(fee>buying.transfer_budget||fee>buying.balance)throw new Error("Transfer fee exceeds the available budget or club balance.");
  if(currentWages+weeklyWage>buying.weekly_wage_budget)throw new Error("Offered wage exceeds the remaining weekly wage budget.");
  return Number(db.prepare(`INSERT INTO transfer_negotiation(player_id,selling_club_id,buying_club_id,offer_fee,offered_weekly_wage,contract_years,status,last_message)
    VALUES(?,?,?,?,?,?,'OPEN','Oferta inicial enviada')`).run(playerId,player.clubId,buyingClubId,fee,weeklyWage,years).lastInsertRowid);
}

export function respondToTransferOffer(db:SqliteDatabase,offerId:number,action:"ACCEPT"|"REJECT"|"COUNTER",counter?:{fee:number;weeklyWage:number;years:number},seasonYear=seasonYearForPlayer(db)):void {
  ensureRosterLifecycleSchema(db);
  const offer=db.prepare("SELECT * FROM transfer_negotiation WHERE id=?").get(offerId) as {id:number;player_id:number;selling_club_id:number|null;buying_club_id:number;offer_fee:number;offered_weekly_wage:number;contract_years:number;status:string}|undefined;
  if(!offer||!["OPEN","COUNTERED"].includes(offer.status))throw new Error("Offer is not open for negotiation.");
  if(action==="REJECT") { db.prepare("UPDATE transfer_negotiation SET status='REJECTED',resolved_at=CURRENT_TIMESTAMP,last_message='Oferta rejeitada' WHERE id=?").run(offerId); return; }
  if(action==="COUNTER") {
    if(!counter||!Number.isSafeInteger(counter.fee)||counter.fee<0||!Number.isSafeInteger(counter.weeklyWage)||counter.weeklyWage<0||!Number.isSafeInteger(counter.years)||counter.years<1||counter.years>5)throw new Error("Counteroffer requires valid fee, weekly wage and 1–5 contract years.");
    db.prepare("UPDATE transfer_negotiation SET offer_fee=?,offered_weekly_wage=?,contract_years=?,status='COUNTERED',last_message='Contraproposta enviada' WHERE id=?").run(counter.fee,counter.weeklyWage,counter.years,offerId); return;
  }
  const buying=db.prepare("SELECT balance,transfer_budget,weekly_wage_budget FROM club_finance WHERE club_id=?").get(offer.buying_club_id) as {balance:number;transfer_budget:number;weekly_wage_budget:number};
  const wageBill=(db.prepare("SELECT COALESCE(SUM(weekly_wage),0) AS n FROM player_contract WHERE club_id=? AND status='ACTIVE' AND player_id<>?").get(offer.buying_club_id,offer.player_id) as {n:number}).n;
  if(offer.offer_fee>buying.balance||offer.offer_fee>buying.transfer_budget)throw new Error("The current transfer fee exceeds the buyer's available budget.");
  if(wageBill+offer.offered_weekly_wage>buying.weekly_wage_budget)throw new Error("The current wage exceeds the buyer's weekly wage budget.");
  const currentClub=db.prepare("SELECT club_id AS clubId FROM squad_membership WHERE player_id=?").get(offer.player_id) as {clubId:number}|undefined;
  if(currentClub&&currentClub.clubId!==offer.selling_club_id)throw new Error("Player's club changed during negotiations; offer is stale.");
  const transaction=db.transaction(()=>{
    db.prepare("UPDATE club_finance SET balance=balance-?,transfer_budget=transfer_budget-? WHERE club_id=?").run(offer.offer_fee,offer.offer_fee,offer.buying_club_id);
    if(offer.selling_club_id!==null)db.prepare("UPDATE club_finance SET balance=balance+?,transfer_budget=MIN(balance,transfer_budget+?) WHERE club_id=?").run(offer.offer_fee,Math.round(offer.offer_fee*.7),offer.selling_club_id);
    if(currentClub)db.prepare("DELETE FROM squad_membership WHERE player_id=?").run(offer.player_id);
    const shirt=(db.prepare("SELECT COALESCE(MAX(shirt_number),0)+1 AS n FROM squad_membership WHERE club_id=?").get(offer.buying_club_id) as {n:number}).n;
    db.prepare("INSERT INTO squad_membership(player_id,club_id,shirt_number,squad_status) VALUES(?,?,?,'FIRST_TEAM')").run(offer.player_id,offer.buying_club_id,shirt<=99?shirt:null);
    db.prepare(`INSERT INTO player_contract(player_id,club_id,start_season,end_season,weekly_wage,status)
      VALUES(?,?,?,?,?,'ACTIVE') ON CONFLICT(player_id) DO UPDATE SET club_id=excluded.club_id,start_season=excluded.start_season,end_season=excluded.end_season,weekly_wage=excluded.weekly_wage,status='ACTIVE',updated_at=CURRENT_TIMESTAMP`)
      .run(offer.player_id,offer.buying_club_id,seasonYear,seasonYear+offer.contract_years-1,offer.offered_weekly_wage);
    db.prepare("INSERT INTO transfer_history(player_id,from_club_id,to_club_id,fee,season_year,transfer_type,details) VALUES(?,?,?,?,?,'TRANSFER',?)")
      .run(offer.player_id,offer.selling_club_id,offer.buying_club_id,offer.offer_fee,seasonYear,`Transferência concluída via negociação #${offer.id}`);
    db.prepare("UPDATE transfer_negotiation SET status='COMPLETED',resolved_at=CURRENT_TIMESTAMP,last_message='Transferência concluída' WHERE id=?").run(offerId);
  });
  transaction();
}

export function listPlayerHistory(db:SqliteDatabase,playerId:number):Array<Record<string,unknown>> {
  ensureRosterLifecycleSchema(db);
  return db.prepare(`
    SELECT h.season_year AS seasonYear,h.age,h.overall_rating AS overall,h.potential,h.weekly_wage AS weeklyWage,
      h.appearances,h.minutes_played AS minutes,h.goals,h.status,c.name AS club
    FROM player_season_history h LEFT JOIN club c ON c.id=h.club_id WHERE h.player_id=? ORDER BY h.season_year
  `).all(playerId) as Array<Record<string,unknown>>;
}

export function listClubFinances(db:SqliteDatabase,clubId?:number):Array<Record<string,unknown>> {
  ensureRosterLifecycleSchema(db);
  return db.prepare(`
    SELECT c.id AS clubId,c.name AS club,f.balance,f.transfer_budget AS transferBudget,
      f.weekly_wage_budget AS weeklyWageBudget,
      COALESCE((SELECT SUM(pc.weekly_wage) FROM player_contract pc WHERE pc.club_id=c.id AND pc.status='ACTIVE'),0) AS wageBillWeekly,
      (SELECT COUNT(*) FROM squad_membership sm WHERE sm.club_id=c.id) AS squadSize
    FROM club c JOIN club_finance f ON f.club_id=c.id WHERE (? IS NULL OR c.id=?) ORDER BY c.reputation DESC,c.name
  `).all(clubId??null,clubId??null) as Array<Record<string,unknown>>;
}

export function listTransferHistory(db:SqliteDatabase,playerId?:number):Array<Record<string,unknown>> {
  ensureRosterLifecycleSchema(db);
  return db.prepare(`
    SELECT h.id,h.season_year AS seasonYear,p.full_name AS player,
      old.name AS fromClub,new.name AS toClub,h.fee,h.transfer_type AS type,h.details,h.occurred_at AS occurredAt
    FROM transfer_history h JOIN person p ON p.id=h.player_id
    LEFT JOIN club old ON old.id=h.from_club_id LEFT JOIN club new ON new.id=h.to_club_id
    WHERE (? IS NULL OR h.player_id=?) ORDER BY h.season_year DESC,h.id DESC
  `).all(playerId??null,playerId??null) as Array<Record<string,unknown>>;
}
