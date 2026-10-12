import type { SqliteDatabase } from "../db/database.js";

export type DataPackage = {
  schemaVersion: 1;
  id: string;
  version: string;
  minGameVersion?: string;
  dependencies?: Array<{ id: string; version?: string }>;
  nations?: Array<{ code: string; name: string }>;
  cities?: Array<{ code: string; nationCode: string; name: string; climateProfile?: string }>;
  clubs?: Array<{ code: string; nationCode: string; cityCode?: string; name: string; shortName?: string; reputation?: number; primaryColor?: string; secondaryColor?: string }>;
  stadiums?: Array<{ code: string; clubCode?: string; cityCode?: string; name: string; capacity?: number; pitchQuality?: number }>;
  players?: Array<{
    code: string; name: string; nationalityCode?: string; birthDate?: string;
    potential?: number; preferredFoot?: "LEFT" | "RIGHT" | "BOTH"; goalkeeper?: boolean;
    clubCode?: string; squadStatus?: "FIRST_TEAM" | "RESERVE" | "YOUTH"; shirtNumber?: number;
    attributes?: Record<string, number>; positions?: Array<{ code: string; rating: number }>;
  }>;
  competitions?: Array<{
    code: string; name: string; nationCode?: string; tier?: number; kind?: "LEAGUE" | "CUP" | "SUPER_CUP" | "PLAYOFF" | "OTHER";
    seasons: Array<{
      year: number; startDate?: string; endDate?: string;
      stages: Array<{
        code: string; name: string; order: number; kind: "LEAGUE" | "GROUPS" | "KNOCKOUT" | "SINGLE_MATCH" | "FINAL";
        format?: { groupCount?: number; legs?: number; homeAway?: boolean; extraTime?: boolean; penalties?: boolean; awayGoalsRule?: boolean; winPoints?: number; drawPoints?: number; lossPoints?: number };
        standingsRules?: string[];
        groups?: Array<{ code: string; name: string }>;
        participants: Array<{ clubCode: string; groupCode?: string; seed?: number }>;
        calendar?: Array<{ number: number; name?: string; date?: string; fixtures: Array<{ homeClubCode: string; awayClubCode: string; date?: string; stadiumCode?: string }> }>;
        promotionRelegation?: Array<{ positionFrom: number; positionTo: number; movementType: "PROMOTE" | "RELEGATE" | "PLAYOFF"; targetCompetitionCode?: string; targetTier?: number; priority?: number }>;
      }>;
    }>;
  }>;
};

const STANDING_RULES = new Set(["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR", "HEAD_TO_HEAD", "WINS", "FAIR_PLAY", "DRAW"]);
const ATTRIBUTES = new Set([
  "pace", "acceleration", "stamina", "strength", "agility", "positioning", "anticipation", "decisions",
  "composure", "teamwork", "work_rate", "passing", "vision", "crossing", "dribbling", "finishing",
  "long_shots", "heading", "tackling", "marking", "aggression", "concentration", "reflexes", "handling", "aerial_reach",
]);

type EntityType = "nation" | "city" | "club" | "stadium" | "player" | "competition" | "season" | "stage";

export function ensureDataPackageSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS data_package_install (
      package_id TEXT PRIMARY KEY, version TEXT NOT NULL, manifest_json TEXT NOT NULL,
      installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS data_package_entity (
      package_id TEXT NOT NULL REFERENCES data_package_install(package_id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL, external_id TEXT NOT NULL, local_id INTEGER NOT NULL,
      PRIMARY KEY(package_id, entity_type, external_id)
    );
    CREATE TABLE IF NOT EXISTS data_package_competition_tier (
      competition_id INTEGER PRIMARY KEY REFERENCES competition(id) ON DELETE CASCADE,
      tier INTEGER NOT NULL CHECK(tier > 0),
      package_id TEXT NOT NULL
    );
  `);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function code(value: unknown, label: string): string {
  assert(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value), `${label} must be a 1–64 character stable code (letters, digits, dot, underscore or hyphen).`);
  return value;
}
function textValue(value: unknown, label: string): string {
  assert(typeof value === "string" && value.trim().length > 0 && value.length <= 200, `${label} must be a non-empty string of at most 200 characters.`);
  return value.trim();
}
function positiveInt(value: unknown, label: string, allowZero = false): number {
  assert(Number.isSafeInteger(value) && (value as number) >= (allowZero ? 0 : 1), `${label} must be an integer ${allowZero ? ">= 0" : "> 0"}.`);
  return value as number;
}
function unique(values: string[], label: string): void {
  assert(new Set(values).size === values.length, `Duplicate ${label} code found in package.`);
}
function versionParts(version: string): number[] {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : [0, 0, 0];
}
function compareVersions(a: string, b: string): number {
  const left = versionParts(a), right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i]! - right[i]!;
  return 0;
}
function entityKey(type: EntityType, externalId: string): string { return `${type}:${externalId}`; }

export function parseDataPackage(raw: string): DataPackage {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Data package is not valid JSON."); }
  assert(value !== null && typeof value === "object" && !Array.isArray(value), "Data package root must be a JSON object.");
  const pkg = value as DataPackage;
  assert(pkg.schemaVersion === 1, `Unsupported data package schemaVersion: ${String(pkg.schemaVersion)}. Supported: 1.`);
  code(pkg.id, "package.id"); textValue(pkg.version, "package.version");
  assert(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version), "package.version must use semantic versioning (for example 1.0.0).");
  for (const key of ["nations", "cities", "clubs", "stadiums", "players", "competitions"] as const) {
    if (pkg[key] !== undefined) assert(Array.isArray(pkg[key]), `${key} must be an array.`);
  }
  const nationCodes = (pkg.nations ?? []).map(x => code(x.code, "nation.code"));
  const cityCodes = (pkg.cities ?? []).map(x => code(x.code, "city.code"));
  const clubCodes = (pkg.clubs ?? []).map(x => code(x.code, "club.code"));
  const stadiumCodes = (pkg.stadiums ?? []).map(x => code(x.code, "stadium.code"));
  const playerCodes = (pkg.players ?? []).map(x => code(x.code, "player.code"));
  const competitionCodes = (pkg.competitions ?? []).map(x => code(x.code, "competition.code"));
  unique(nationCodes, "nation"); unique(cityCodes, "city"); unique(clubCodes, "club");
  unique(stadiumCodes, "stadium"); unique(playerCodes, "player"); unique(competitionCodes, "competition");
  for (const nation of pkg.nations ?? []) textValue(nation.name, `nation ${nation.code}.name`);
  for (const city of pkg.cities ?? []) { code(city.nationCode, "city.nationCode"); textValue(city.name, "city.name"); }
  for (const club of pkg.clubs ?? []) { code(club.nationCode, "club.nationCode"); textValue(club.name, "club.name"); if (club.cityCode) code(club.cityCode, "club.cityCode"); }
  for (const stadium of pkg.stadiums ?? []) { textValue(stadium.name, "stadium.name"); if (stadium.clubCode) code(stadium.clubCode, "stadium.clubCode"); if (stadium.cityCode) code(stadium.cityCode, "stadium.cityCode"); }
  for (const player of pkg.players ?? []) {
    textValue(player.name, "player.name");
    if (player.clubCode) code(player.clubCode, "player.clubCode");
    if (player.nationalityCode) code(player.nationalityCode, "player.nationalityCode");
    for (const [attribute, rating] of Object.entries(player.attributes ?? {})) {
      assert(ATTRIBUTES.has(attribute), `Unknown player attribute "${attribute}".`);
      assert(Number.isInteger(rating) && rating >= 0 && rating <= 100, `Player attribute ${attribute} must be an integer from 0 to 100.`);
    }
    for (const position of player.positions ?? []) { code(position.code, "position.code"); assert(Number.isInteger(position.rating) && position.rating >= 0 && position.rating <= 100, "Position rating must be an integer from 0 to 100."); }
  }
  for (const competition of pkg.competitions ?? []) {
    textValue(competition.name, "competition.name");
    assert(Array.isArray(competition.seasons) && competition.seasons.length > 0, `Competition ${competition.code} needs at least one season.`);
    const seasonYears = competition.seasons.map(s => positiveInt(s.year, "season.year"));
    unique(seasonYears.map(String), `season year in ${competition.code}`);
    for (const season of competition.seasons) {
      assert(Array.isArray(season.stages) && season.stages.length > 0, `Season ${competition.code}/${season.year} needs at least one stage.`);
      for (const stage of season.stages) {
        code(stage.code, "stage.code"); textValue(stage.name, "stage.name"); positiveInt(stage.order, "stage.order");
        assert(["LEAGUE", "GROUPS", "KNOCKOUT", "SINGLE_MATCH", "FINAL"].includes(stage.kind), `Unsupported stage kind ${stage.kind}.`);
        assert(Array.isArray(stage.participants) && stage.participants.length >= 2, `Stage ${stage.code} needs at least two participants.`);
        unique(stage.participants.map(p => code(p.clubCode, "participant.clubCode")), `participant in ${stage.code}`);
        for (const rule of stage.standingsRules ?? ["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR"]) assert(STANDING_RULES.has(rule), `Unknown standings rule ${rule}.`);
        for (const movement of stage.promotionRelegation ?? []) {
          positiveInt(movement.positionFrom, "movement.positionFrom"); positiveInt(movement.positionTo, "movement.positionTo");
          assert(movement.positionTo >= movement.positionFrom, "Movement positionTo must be >= positionFrom.");
          assert(Boolean(movement.targetCompetitionCode) !== (movement.targetTier !== undefined), "Movement must specify exactly one of targetCompetitionCode or targetTier.");
          if (movement.targetCompetitionCode) code(movement.targetCompetitionCode, "movement.targetCompetitionCode");
          if (movement.targetTier !== undefined) positiveInt(movement.targetTier, "movement.targetTier");
        }
      }
    }
  }
  return pkg;
}

function packageInstalledVersion(db: SqliteDatabase, id: string): string | undefined {
  const row = db.prepare("SELECT version FROM data_package_install WHERE package_id=?").get(id) as { version: string } | undefined;
  return row?.version;
}
function lookupEntity(db: SqliteDatabase, type: EntityType, externalId: string, packageId?: string): number | undefined {
  if (packageId) {
    const row = db.prepare("SELECT local_id FROM data_package_entity WHERE package_id=? AND entity_type=? AND external_id=?").get(packageId, type, externalId) as { local_id: number } | undefined;
    return row?.local_id;
  }
  const rows = db.prepare("SELECT local_id FROM data_package_entity WHERE entity_type=? AND external_id=?").all(type, externalId) as Array<{ local_id: number }>;
  const ids = [...new Set(rows.map(row => row.local_id))];
  if (ids.length > 1) throw new Error(`Ambiguous reference ${type} "${externalId}"; use a package dependency that owns the entity.`);
  if (ids[0] !== undefined) return ids[0];
  if (type === "nation") return (db.prepare("SELECT id FROM nation WHERE code=?").get(externalId) as {id:number}|undefined)?.id;
  if (type === "club") return (db.prepare("SELECT id FROM club WHERE short_name=?").get(externalId) as {id:number}|undefined)?.id;
  if (type === "competition") return (db.prepare("SELECT id FROM competition WHERE code=?").get(externalId) as {id:number}|undefined)?.id;
  return undefined;
}
function recordEntity(db: SqliteDatabase, pkg: DataPackage, type: EntityType, externalId: string, localId: number): void {
  db.prepare("INSERT INTO data_package_entity(package_id,entity_type,external_id,local_id) VALUES(?,?,?,?) ON CONFLICT(package_id,entity_type,external_id) DO UPDATE SET local_id=excluded.local_id").run(pkg.id, type, externalId, localId);
}
function localRef(db: SqliteDatabase, pkg: DataPackage, type: EntityType, externalId: string, localCodes: Map<string, number>): number {
  const local = localCodes.get(entityKey(type, externalId)) ?? lookupEntity(db, type, externalId);
  assert(local !== undefined, `Unresolved reference ${type} "${externalId}". Include it in this package or declare its owning package as a dependency.`);
  return local;
}

export function validateDataPackage(db: SqliteDatabase, pkg: DataPackage): string[] {
  ensureDataPackageSchema(db);
  const errors: string[] = [];
  if (compareVersions("0.1.0", pkg.minGameVersion ?? "0.1.0") < 0) errors.push(`Package requires game version ${pkg.minGameVersion}; current version is 0.1.0.`);
  for (const dependency of pkg.dependencies ?? []) {
    const installed = packageInstalledVersion(db, dependency.id);
    if (!installed) errors.push(`Missing dependency: ${dependency.id}.`);
    else if (dependency.version && installed !== dependency.version) errors.push(`Dependency ${dependency.id} requires ${dependency.version}, installed version is ${installed}.`);
  }
  const checkRef = (type: EntityType, externalId: string, local: Set<string>) => {
    if (!local.has(externalId) && !lookupEntity(db, type, externalId)) errors.push(`Unresolved reference ${type} "${externalId}".`);
  };
  const nations = new Set((pkg.nations ?? []).map(x => x.code));
  const cities = new Set((pkg.cities ?? []).map(x => x.code));
  const clubs = new Set((pkg.clubs ?? []).map(x => x.code));
  const stadiums = new Set((pkg.stadiums ?? []).map(x => x.code));
  const competitions = new Set((pkg.competitions ?? []).map(x => x.code));
  for (const city of pkg.cities ?? []) if (!nations.has(city.nationCode)) checkRef("nation", city.nationCode, nations);
  for (const club of pkg.clubs ?? []) {
    if (!nations.has(club.nationCode)) checkRef("nation", club.nationCode, nations);
    if (club.cityCode && !cities.has(club.cityCode)) checkRef("city", club.cityCode, cities);
  }
  for (const stadium of pkg.stadiums ?? []) {
    if (stadium.clubCode && !clubs.has(stadium.clubCode)) checkRef("club", stadium.clubCode, clubs);
    if (stadium.cityCode && !cities.has(stadium.cityCode)) checkRef("city", stadium.cityCode, cities);
  }
  for (const player of pkg.players ?? []) {
    if (player.nationalityCode && !nations.has(player.nationalityCode)) checkRef("nation", player.nationalityCode, nations);
    if (player.clubCode && !clubs.has(player.clubCode)) checkRef("club", player.clubCode, clubs);
  }
  for (const competition of pkg.competitions ?? []) {
    if (competition.nationCode && !nations.has(competition.nationCode)) checkRef("nation", competition.nationCode, nations);
    for (const season of competition.seasons) for (const stage of season.stages) {
      for (const participant of stage.participants) if (!clubs.has(participant.clubCode)) checkRef("club", participant.clubCode, clubs);
      for (const movement of stage.promotionRelegation ?? []) if (movement.targetCompetitionCode && !competitions.has(movement.targetCompetitionCode)) checkRef("competition", movement.targetCompetitionCode, competitions);
      const groupCodes = new Set((stage.groups ?? []).map(group => group.code));
      if (stage.participants.some(p => p.groupCode && !groupCodes.has(p.groupCode))) errors.push(`Stage ${stage.code} references an undefined group.`);
      if ((stage.format?.groupCount ?? 1) > 1 && (stage.groups?.length ?? 0) < (stage.format?.groupCount ?? 1)) errors.push(`Stage ${stage.code} has fewer groups than format.groupCount.`);
      if (stage.calendar) {
        const participantCodes = new Set(stage.participants.map(p => p.clubCode));
        const seenRounds = new Set<number>();
        for (const round of stage.calendar) {
          if (seenRounds.has(round.number)) errors.push(`Stage ${stage.code} has duplicate round number ${round.number}.`);
          seenRounds.add(round.number);
          for (const fixture of round.fixtures) {
            if (fixture.homeClubCode === fixture.awayClubCode) errors.push(`Stage ${stage.code} has a fixture where a club plays itself.`);
            for (const clubCode of [fixture.homeClubCode, fixture.awayClubCode]) if (!participantCodes.has(clubCode)) errors.push(`Fixture in ${stage.code} references non-participant club ${clubCode}.`);
            if (fixture.stadiumCode && !stadiums.has(fixture.stadiumCode) && !lookupEntity(db, "stadium", fixture.stadiumCode)) errors.push(`Unknown stadium ${fixture.stadiumCode} in ${stage.code} calendar.`);
          }
        }
      }
    }
  }
  return errors;
}

function roundRobin(ids: number[], legs: number): Array<Array<{ home: number; away: number }>> {
  const teams = [...ids]; if (teams.length % 2) teams.push(-1);
  const rounds: Array<Array<{ home: number; away: number }>> = [];
  for (let leg = 0; leg < legs; leg++) {
    const rotating = [...teams];
    for (let round = 0; round < rotating.length - 1; round++) {
      const fixtures: Array<{ home: number; away: number }> = [];
      for (let i = 0; i < rotating.length / 2; i++) {
        const a = rotating[i]!, b = rotating[rotating.length - 1 - i]!;
        if (a !== -1 && b !== -1) fixtures.push((round + leg) % 2 === 0 ? { home: a, away: b } : { home: b, away: a });
      }
      rounds.push(fixtures);
      const fixed = rotating[0]!;
      const rest = rotating.slice(1); rest.unshift(rest.pop()!); rotating.splice(0, rotating.length, fixed, ...rest);
    }
  }
  return rounds;
}

export function installDataPackage(db: SqliteDatabase, pkg: DataPackage): { packageId: string; version: string; created: number; updated: number; stages: number; fixtures: number } {
  ensureDataPackageSchema(db);
  const errors = validateDataPackage(db, pkg);
  if (errors.length) throw new Error("Data package validation failed:\n- " + errors.join("\n- "));
  const installed = packageInstalledVersion(db, pkg.id);
  if (installed === pkg.version) return { packageId: pkg.id, version: pkg.version, created: 0, updated: 0, stages: 0, fixtures: 0 };
  if (installed && compareVersions(pkg.version, installed) <= 0) throw new Error(`Package ${pkg.id} version ${pkg.version} is not newer than installed version ${installed}.`);
  const localCodes = new Map<string, number>();
  const result = db.transaction(() => {
    db.prepare("INSERT INTO data_package_install(package_id,version,manifest_json) VALUES(?,?,?) ON CONFLICT(package_id) DO UPDATE SET version=excluded.version,manifest_json=excluded.manifest_json,installed_at=CURRENT_TIMESTAMP").run(pkg.id, pkg.version, JSON.stringify({ id: pkg.id, version: pkg.version, schemaVersion: pkg.schemaVersion, dependencies: pkg.dependencies ?? [] }));
    let created = 0, updated = 0, stages = 0, fixtures = 0;
    const remember = (type: EntityType, externalId: string, id: number) => { localCodes.set(entityKey(type, externalId), id); recordEntity(db, pkg, type, externalId, id); };
    for (const item of pkg.nations ?? []) {
      const existing = db.prepare("SELECT id FROM nation WHERE code=?").get(item.code) as {id:number}|undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO nation(name,code) VALUES(?,?)").run(item.name,item.code).lastInsertRowid);
      if (existing) { db.prepare("UPDATE nation SET name=? WHERE id=?").run(item.name,id); updated++; } else created++;
      remember("nation",item.code,id);
    }
    for (const item of pkg.cities ?? []) {
      const nationId = localRef(db,pkg,"nation",item.nationCode,localCodes);
      const existing = db.prepare("SELECT id FROM city WHERE nation_id=? AND name=?").get(nationId,item.name) as {id:number}|undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO city(nation_id,name,climate_profile) VALUES(?,?,?)").run(nationId,item.name,item.climateProfile ?? "TEMPERATE").lastInsertRowid);
      if (existing) db.prepare("UPDATE city SET climate_profile=? WHERE id=?").run(item.climateProfile ?? "TEMPERATE",id);
      else created++;
      remember("city",item.code,id);
    }
    for (const item of pkg.clubs ?? []) {
      const nationId = localRef(db,pkg,"nation",item.nationCode,localCodes);
      const cityId = item.cityCode ? localRef(db,pkg,"city",item.cityCode,localCodes) : null;
      const existing = db.prepare("SELECT id FROM club WHERE nation_id=? AND name=?").get(nationId,item.name) as {id:number}|undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO club(nation_id,city_id,name,short_name,reputation,primary_color,secondary_color) VALUES(?,?,?,?,?,?,?)").run(nationId,cityId,item.name,item.shortName ?? item.code,item.reputation ?? 50,item.primaryColor ?? null,item.secondaryColor ?? null).lastInsertRowid);
      if (existing) { db.prepare("UPDATE club SET city_id=?,short_name=?,reputation=?,primary_color=?,secondary_color=? WHERE id=?").run(cityId,item.shortName ?? item.code,item.reputation ?? 50,item.primaryColor ?? null,item.secondaryColor ?? null,id); updated++; } else created++;
      remember("club",item.code,id);
      db.prepare("INSERT INTO team_tactic(club_id,formation_id) VALUES(?,(SELECT id FROM formation ORDER BY id LIMIT 1)) ON CONFLICT(club_id) DO NOTHING").run(id);
    }
    for (const item of pkg.stadiums ?? []) {
      const clubId = item.clubCode ? localRef(db,pkg,"club",item.clubCode,localCodes) : null;
      const cityId = item.cityCode ? localRef(db,pkg,"city",item.cityCode,localCodes) : null;
      const existing = db.prepare("SELECT id FROM stadium WHERE city_id IS ? AND name=?").get(cityId,item.name) as {id:number}|undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO stadium(club_id,city_id,name,capacity,pitch_quality) VALUES(?,?,?,?,?)").run(clubId,cityId,item.name,item.capacity ?? 10000,item.pitchQuality ?? 70).lastInsertRowid);
      if (existing) db.prepare("UPDATE stadium SET club_id=?,capacity=?,pitch_quality=? WHERE id=?").run(clubId,item.capacity ?? 10000,item.pitchQuality ?? 70,id);
      else created++;
      remember("stadium",item.code,id);
    }
    for (const item of pkg.players ?? []) {
      const nationId = item.nationalityCode ? localRef(db,pkg,"nation",item.nationalityCode,localCodes) : null;
      const existingId = lookupEntity(db,"player",item.code,pkg.id);
      let id: number;
      if (existingId) {
        id = existingId;
        db.prepare("UPDATE person SET full_name=?,birth_date=?,nationality_id=? WHERE id=?").run(item.name,item.birthDate ?? null,nationId,id);
        db.prepare("UPDATE player SET potential=?,preferred_foot=?,goalkeeper=? WHERE person_id=?").run(item.potential ?? 50,item.preferredFoot ?? "RIGHT",item.goalkeeper ? 1 : 0,id);
        updated++;
      } else {
        id = Number(db.prepare("INSERT INTO person(full_name,birth_date,nationality_id) VALUES(?,?,?)").run(item.name,item.birthDate ?? null,nationId).lastInsertRowid);
        db.prepare("INSERT INTO player(person_id,potential,preferred_foot,goalkeeper) VALUES(?,?,?,?)").run(id,item.potential ?? 50,item.preferredFoot ?? "RIGHT",item.goalkeeper ? 1 : 0);
        db.prepare("INSERT INTO player_attribute(player_id) VALUES(?)").run(id);
        db.prepare("INSERT INTO player_condition(player_id) VALUES(?)").run(id);
        created++;
      }
      const attrs = item.attributes ?? {};
      for (const [attribute,value] of Object.entries(attrs)) db.prepare(`UPDATE player_attribute SET ${attribute}=? WHERE player_id=?`).run(value,id);
      for (const position of item.positions ?? []) db.prepare("INSERT INTO player_position(player_id,position_code,rating) VALUES(?,?,?) ON CONFLICT(player_id,position_code) DO UPDATE SET rating=excluded.rating").run(id,position.code,position.rating);
      if (item.clubCode) {
        const clubId = localRef(db,pkg,"club",item.clubCode,localCodes);
        db.prepare("INSERT INTO squad_membership(player_id,club_id,shirt_number,squad_status) VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET club_id=excluded.club_id,shirt_number=excluded.shirt_number,squad_status=excluded.squad_status").run(id,clubId,item.shirtNumber ?? null,item.squadStatus ?? "FIRST_TEAM");
      }
      remember("player",item.code,id);
    }
    for (const competition of pkg.competitions ?? []) {
      const nationId = competition.nationCode ? localRef(db,pkg,"nation",competition.nationCode,localCodes) : null;
      const existing = db.prepare("SELECT id FROM competition WHERE code=?").get(competition.code) as {id:number}|undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO competition(nation_id,name,code,competition_kind) VALUES(?,?,?,?)").run(nationId,competition.name,competition.code,competition.kind ?? "LEAGUE").lastInsertRowid);
      if (existing) db.prepare("UPDATE competition SET nation_id=?,name=?,competition_kind=? WHERE id=?").run(nationId,competition.name,competition.kind ?? "LEAGUE",id);
      remember("competition",competition.code,id);
    }
    for (const competition of pkg.competitions ?? []) {
      const nationId = competition.nationCode ? localRef(db,pkg,"nation",competition.nationCode,localCodes) : null;
      const existing = db.prepare("SELECT id FROM competition WHERE code=?").get(competition.code) as {id:number}|undefined;
      const competitionId = existing?.id ?? Number(db.prepare("INSERT INTO competition(nation_id,name,code,competition_kind) VALUES(?,?,?,?)").run(nationId,competition.name,competition.code,competition.kind ?? "LEAGUE").lastInsertRowid);
      if (existing) { db.prepare("UPDATE competition SET nation_id=?,name=?,competition_kind=? WHERE id=?").run(nationId,competition.name,competition.kind ?? "LEAGUE",competitionId); updated++; } else created++;
      remember("competition",competition.code,competitionId);
      for (const season of competition.seasons) {
        const seasonExisting = db.prepare("SELECT id FROM competition_season WHERE competition_id=? AND season_year=?").get(competitionId,season.year) as {id:number}|undefined;
        const seasonId = seasonExisting?.id ?? Number(db.prepare("INSERT INTO competition_season(competition_id,season_year,start_date,end_date,status) VALUES(?,?,?,?,'PLANNED')").run(competitionId,season.year,season.startDate ?? null,season.endDate ?? null).lastInsertRowid);
        if (seasonExisting) { db.prepare("UPDATE competition_season SET start_date=?,end_date=? WHERE id=?").run(season.startDate ?? null,season.endDate ?? null,seasonId); updated++; } else created++;
        remember("season",`${competition.code}:${season.year}`,seasonId);
        db.prepare("DELETE FROM competition_entry WHERE season_id=?").run(seasonId);
        for (const stage of season.stages) {
          const stageKey = `${competition.code}:${season.year}:${stage.code}`;
          const stageExisting = db.prepare("SELECT id FROM competition_stage WHERE season_id=? AND stage_order=?").get(seasonId,stage.order) as {id:number}|undefined;
          const stageId = stageExisting?.id ?? Number(db.prepare("INSERT INTO competition_stage(season_id,name,stage_order,stage_kind) VALUES(?,?,?,?)").run(seasonId,stage.name,stage.order,stage.kind).lastInsertRowid);
          if (stageExisting) { db.prepare("UPDATE competition_stage SET name=?,stage_kind=? WHERE id=?").run(stage.name,stage.kind,stageId); updated++; } else created++;
          stages++;
          remember("stage",stageKey,stageId);
          const format = stage.format ?? {};
          db.prepare(`INSERT INTO stage_format(stage_id,group_count,legs,home_away,extra_time,penalties,away_goals_rule,win_points,draw_points,loss_points)
            VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(stage_id) DO UPDATE SET group_count=excluded.group_count,legs=excluded.legs,home_away=excluded.home_away,extra_time=excluded.extra_time,penalties=excluded.penalties,away_goals_rule=excluded.away_goals_rule,win_points=excluded.win_points,draw_points=excluded.draw_points,loss_points=excluded.loss_points`)
            .run(stageId,format.groupCount ?? 1,format.legs ?? 1,format.homeAway === false ? 0 : 1,format.extraTime ? 1 : 0,format.penalties ? 1 : 0,format.awayGoalsRule ? 1 : 0,format.winPoints ?? 3,format.drawPoints ?? 1,format.lossPoints ?? 0);
          const groups = stage.groups?.length ? stage.groups : [{code:"A",name:"Grupo A"}];
          for (let i=0;i<groups.length;i++) db.prepare("INSERT INTO stage_group(stage_id,group_code,name,sort_order) VALUES(?,?,?,?) ON CONFLICT(stage_id,group_code) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order").run(stageId,groups[i]!.code,groups[i]!.name,i+1);
          db.prepare("DELETE FROM stage_standing_rule WHERE stage_id=?").run(stageId);
          for (const [index,rule] of (stage.standingsRules ?? ["POINTS","GOAL_DIFFERENCE","GOALS_FOR","HEAD_TO_HEAD"]).entries()) db.prepare("INSERT INTO stage_standing_rule(stage_id,rule_order,rule_key) VALUES(?,?,?)").run(stageId,index+1,rule);
          db.prepare("DELETE FROM stage_participant WHERE stage_id=?").run(stageId);
          db.prepare("DELETE FROM stage_standing WHERE stage_id=?").run(stageId);
          const groupRows = db.prepare("SELECT id,group_code FROM stage_group WHERE stage_id=?").all(stageId) as Array<{id:number;group_code:string}>;
          const groupIds = new Map(groupRows.map(g=>[g.group_code,g.id]));
          for (const [index,participant] of stage.participants.entries()) {
            const clubId=localRef(db,pkg,"club",participant.clubCode,localCodes);
            const groupId=groupIds.get(participant.groupCode ?? groups[0]!.code);
            assert(groupId!==undefined,`Undefined group ${participant.groupCode} in stage ${stage.code}.`);
            db.prepare("INSERT INTO stage_participant(stage_id,club_id,group_id,seed) VALUES(?,?,?,?)").run(stageId,clubId,groupId,participant.seed ?? index+1);
            db.prepare("INSERT INTO stage_standing(stage_id,club_id,group_id) VALUES(?,?,?)").run(stageId,clubId,groupId);
            db.prepare("INSERT INTO competition_entry(season_id,club_id,seed) VALUES(?,?,?) ON CONFLICT(season_id,club_id) DO UPDATE SET seed=excluded.seed").run(seasonId,clubId,participant.seed ?? index+1);
          }
          db.prepare("INSERT INTO schedule_profile(stage_id) VALUES(?) ON CONFLICT(stage_id) DO NOTHING").run(stageId);
          const oldFixtures = db.prepare("SELECT f.status FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=?").all(stageId) as Array<{status:string}>;
          assert(oldFixtures.every(f=>f.status==="SCHEDULED"),`Cannot replace the calendar for stage ${stage.code} after matches have started.`);
          db.prepare("DELETE FROM competition_round WHERE stage_id=?").run(stageId);
          let rounds = stage.calendar;
          if (!rounds) {
            rounds = [];
            if (stage.kind === "LEAGUE" || stage.kind === "GROUPS") {
              for (const group of groups) {
                const ids=stage.participants.filter(p=>(p.groupCode ?? groups[0]!.code)===group.code).map(p=>localRef(db,pkg,"club",p.clubCode,localCodes));
                const generated=roundRobin(ids,format.legs ?? 1);
                generated.forEach((fixtures,ri)=>{
                  const roundNumber=ri+1;
                  const existingRound=rounds!.find(r=>r.number===roundNumber);
                  const mapped=fixtures.map(f=>({homeClubCode:stage.participants.find(p=>localRef(db,pkg,"club",p.clubCode,localCodes)===f.home)!.clubCode,awayClubCode:stage.participants.find(p=>localRef(db,pkg,"club",p.clubCode,localCodes)===f.away)!.clubCode}));
                  if(existingRound) existingRound.fixtures.push(...mapped);
                  else rounds!.push({number:roundNumber,name:`Rodada ${roundNumber}`,fixtures:mapped});
                });
              }
            } else {
              const seeded=[...stage.participants].sort((a,b)=>(a.seed ?? 9999)-(b.seed ?? 9999));
              rounds.push({number:1,name:stage.name,fixtures:Array.from({length:Math.floor(seeded.length/2)},(_,i)=>({homeClubCode:seeded[i]!.clubCode,awayClubCode:seeded[seeded.length-1-i]!.clubCode}))});
            }
          }
          const insertRound=db.prepare("INSERT INTO competition_round(stage_id,round_number,name,start_date,end_date) VALUES(?,?,?,?,?)");
          const insertFixture=db.prepare("INSERT INTO fixture(round_id,home_club_id,away_club_id,stadium_id,scheduled_at,random_seed) VALUES(?,?,?,?,?,?)");
          for (const round of rounds.sort((a,b)=>a.number-b.number)) {
            const baseDate = season.startDate ?? `${season.year}-01-10`;
            const roundDate = new Date(`${baseDate}T00:00:00Z`);
            roundDate.setUTCDate(roundDate.getUTCDate() + (round.number - 1) * 7);
            const date=round.date ?? roundDate.toISOString().slice(0,10);
            const roundId=Number(insertRound.run(stageId,round.number,round.name ?? `Rodada ${round.number}`,date,date).lastInsertRowid);
            for (const [fixtureIndex,fixture] of round.fixtures.entries()) {
              const home=localRef(db,pkg,"club",fixture.homeClubCode,localCodes),away=localRef(db,pkg,"club",fixture.awayClubCode,localCodes);
              assert(home!==away,`Fixture in stage ${stage.code} has same home and away club.`);
              const stadiumId=fixture.stadiumCode ? localRef(db,pkg,"stadium",fixture.stadiumCode,localCodes) : (db.prepare("SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1").get(home) as {id:number}|undefined)?.id ?? null;
              insertFixture.run(roundId,home,away,stadiumId,fixture.date ?? `${date}T${String(16+(fixtureIndex%4)*2).padStart(2,"0")}:00:00`,((season.year*100000)+(round.number*100)+fixtureIndex+1)>>>0);
              fixtures++;
            }
          }
          db.prepare("DELETE FROM promotion_relegation_rule WHERE source_stage_id=?").run(stageId);
          for (const movement of stage.promotionRelegation ?? []) {
            const targetCompetitionId=movement.targetCompetitionCode ? localRef(db,pkg,"competition",movement.targetCompetitionCode,localCodes) : null;
            db.prepare("INSERT INTO promotion_relegation_rule(source_stage_id,position_from,position_to,movement_type,target_competition_id,target_stage_id,target_tier,priority) VALUES(?,?,?,?,?,NULL,?,?)")
              .run(stageId,movement.positionFrom,movement.positionTo,movement.movementType,targetCompetitionId,movement.targetTier ?? null,movement.priority ?? 100);
          }
        }
      }
    }
    for (const competition of pkg.competitions ?? []) {
      const competitionId=localRef(db,pkg,"competition",competition.code,localCodes);
      const tier=competition.tier;
      if(tier!==undefined){positiveInt(tier,"competition.tier");db.prepare("INSERT INTO data_package_competition_tier(competition_id,tier,package_id) VALUES(?,?,?) ON CONFLICT(competition_id) DO UPDATE SET tier=excluded.tier,package_id=excluded.package_id").run(competitionId,tier,pkg.id);}
    }
    return {packageId:pkg.id,version:pkg.version,created,updated,stages,fixtures};
  });
  return result();
}

export function listInstalledDataPackages(db: SqliteDatabase): Array<{id:string;version:string;installedAt:string;dependencies:string}> {
  ensureDataPackageSchema(db);
  return (db.prepare("SELECT package_id AS id,version,installed_at AS installedAt,manifest_json AS dependencies FROM data_package_install ORDER BY package_id").all() as Array<{id:string;version:string;installedAt:string;dependencies:string}>);
}

export function applyPromotionRelegation(db: SqliteDatabase, seasonYear: number): { movements: Array<{clubId:number;club:string;movement:string;from:string;to:string}> } {
  ensureDataPackageSchema(db);
  const rules=db.prepare(`
    SELECT pr.*,st.id AS stageId,cs.season_year AS year,co.name AS sourceName
    FROM promotion_relegation_rule pr JOIN competition_stage st ON st.id=pr.source_stage_id
    JOIN competition_season cs ON cs.id=st.season_id JOIN competition co ON co.id=cs.competition_id
    WHERE cs.season_year=? AND cs.status='COMPLETED' ORDER BY pr.priority,pr.id
  `).all(seasonYear) as Array<{id:number;source_stage_id:number;position_from:number;position_to:number;movement_type:string;target_competition_id:number|null;target_stage_id:number|null;target_tier:number|null;priority:number;stageId:number;year:number;sourceName:string}>;
  const movements: Array<{clubId:number;club:string;movement:string;from:string;to:string}> = [];
  const tx=db.transaction(()=>{
    for(const rule of rules){
      const targetCompetition=rule.target_competition_id ?? (rule.target_tier===null ? null : (db.prepare("SELECT competition_id AS id FROM data_package_competition_tier WHERE tier=? ORDER BY competition_id LIMIT 1").get(rule.target_tier) as {id:number}|undefined)?.id ?? null);
      if(!targetCompetition) throw new Error(`No target competition found for movement rule ${rule.id} (tier ${rule.target_tier ?? "unset"}).`);
      const sourceStage=db.prepare("SELECT season_id FROM competition_stage WHERE id=?").get(rule.source_stage_id) as {season_id:number};
      const targetSeason=db.prepare("SELECT id FROM competition_season WHERE competition_id=? AND season_year=?").get(targetCompetition,seasonYear+1) as {id:number}|undefined;
      if(!targetSeason) throw new Error(`Target competition ${targetCompetition} has no season ${seasonYear+1}; install/prepare it before applying movements.`);
      const targetStage=db.prepare("SELECT id FROM competition_stage WHERE season_id=? ORDER BY stage_order LIMIT 1").get(targetSeason.id) as {id:number}|undefined;
      if(!targetStage) throw new Error(`Target competition ${targetCompetition} has no stage in season ${seasonYear+1}.`);
      const sourceCompetitionId=(db.prepare("SELECT competition_id AS id FROM competition_season WHERE id=?").get(sourceStage.season_id) as {id:number}).id;
      const sourceNextSeason=db.prepare("SELECT id FROM competition_season WHERE competition_id=? AND season_year=?").get(sourceCompetitionId,seasonYear+1) as {id:number}|undefined;
      const sourceNextStage=sourceNextSeason ? db.prepare("SELECT id FROM competition_stage WHERE season_id=? ORDER BY stage_order LIMIT 1").get(sourceNextSeason.id) as {id:number}|undefined : undefined;
      const targetName=(db.prepare("SELECT name FROM competition WHERE id=?").get(targetCompetition) as {name:string}).name;
      const ranking=db.prepare(`
        SELECT ss.club_id AS clubId,c.name AS club,ss.points,ss.goals_for-ss.goals_against AS goalDifference,ss.goals_for AS goalsFor
        FROM stage_standing ss JOIN club c ON c.id=ss.club_id WHERE ss.stage_id=?
        ORDER BY ss.points DESC,goalDifference DESC,goalsFor DESC,ss.club_id
      `).all(rule.source_stage_id) as Array<{clubId:number;club:string;points:number;goalDifference:number;goalsFor:number}>;
      for(const row of ranking.slice(rule.position_from-1,rule.position_to)){
        if(rule.movement_type !== "PLAYOFF" && sourceNextStage) {
          db.prepare("DELETE FROM stage_participant WHERE stage_id=? AND club_id=?").run(sourceNextStage.id,row.clubId);
          db.prepare("DELETE FROM stage_standing WHERE stage_id=? AND club_id=?").run(sourceNextStage.id,row.clubId);
          db.prepare("DELETE FROM competition_entry WHERE season_id=? AND club_id=?").run(sourceNextSeason!.id,row.clubId);
        }
        const already=db.prepare("SELECT 1 FROM stage_participant WHERE stage_id=? AND club_id=?").get(targetStage.id,row.clubId);
        if(!already){
          const group=db.prepare("SELECT id FROM stage_group WHERE stage_id=? ORDER BY sort_order LIMIT 1").get(targetStage.id) as {id:number}|undefined;
          assert(group,"Target stage has no group.");
          db.prepare("INSERT INTO stage_participant(stage_id,club_id,group_id,seed,source_note) VALUES(?,?,?,?,?)").run(targetStage.id,row.clubId,group.id,rule.position_from,`${rule.movement_type} from ${rule.sourceName}`);
          db.prepare("INSERT INTO stage_standing(stage_id,club_id,group_id) VALUES(?,?,?) ON CONFLICT(stage_id,club_id,group_id) DO NOTHING").run(targetStage.id,row.clubId,group.id);
          db.prepare("INSERT INTO competition_entry(season_id,club_id,seed,entry_source) VALUES(?,?,?,'PROMOTION_RELEGATION') ON CONFLICT(season_id,club_id) DO NOTHING").run(targetSeason.id,row.clubId,rule.position_from);
        }
        movements.push({clubId:row.clubId,club:row.club,movement:rule.movement_type,from:rule.sourceName,to:targetName});
      }
    }
  });
  tx();
  return {movements};
}
