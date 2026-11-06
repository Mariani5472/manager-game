import type { SqliteDatabase } from "../db/database.js";

export interface MatchContext {
  weather: string;
  temperatureC: number | null;
  pitchCondition: number;
  restHours: number;
  travelKm: number;
  travelHours: number;
}

function random01(seed: number): number {
  let s = seed >>> 0;
  s += 0x6D2B79F5;
  let v = s;
  v = Math.imul(v ^ (v >>> 15), v | 1);
  v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
  return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
}

export function resolveMatchContext(db: SqliteDatabase, fixtureId: number, clubId: number): MatchContext {
  const neutral: MatchContext = { weather: "CLEAR", temperatureC: 20, pitchCondition: 70, restHours: 168, travelKm: 0, travelHours: 0 };
  if (fixtureId < 0) return neutral;
  const fixture = db.prepare("SELECT f.home_club_id AS home, f.away_club_id AS away, f.scheduled_at AS scheduledAt, f.stadium_id AS stadiumId, COALESCE(f.random_seed, f.id * 2654435761) AS seed FROM fixture f WHERE f.id=?").get(fixtureId) as { home:number; away:number; scheduledAt:string|null; stadiumId:number|null; seed:number } | undefined;
  if (!fixture) return neutral;
  const stadium = db.prepare("SELECT s.pitch_quality AS quality, s.city_id AS cityId FROM stadium s WHERE s.id=?").get(fixture.stadiumId) as { quality:number; cityId:number|null } | undefined;
  let environment = db.prepare("SELECT weather, temperature_c AS temperatureC, pitch_condition AS pitchCondition FROM match_environment WHERE fixture_id=?").get(fixtureId) as { weather:string; temperatureC:number|null; pitchCondition:number } | undefined;
  if (!environment) {
    const city = stadium?.cityId == null ? undefined : db.prepare("SELECT climate_profile AS climate FROM city WHERE id=?").get(stadium.cityId) as { climate:string } | undefined;
    const climate = (city?.climate ?? "TEMPERATE").toUpperCase();
    const pools: Record<string,string[]> = { TROPICAL:["CLEAR","RAIN","HEAVY_RAIN","HEAT"], TEMPERATE:["CLEAR","RAIN","WIND","COLD"], ARID:["CLEAR","CLEAR","WIND","HEAT"], COLD:["CLEAR","WIND","COLD","RAIN"], MEDITERRANEAN:["CLEAR","CLEAR","WIND","RAIN"] };
    const pool = pools[climate] ?? pools.TEMPERATE!;
    const weather = pool[Math.min(pool.length-1, Math.floor(random01(fixture.seed ^ 0x5f3759df) * pool.length))]!;
    environment = { weather, temperatureC: weather === "HEAT" ? 31 : weather === "COLD" ? 4 : weather === "RAIN" || weather === "HEAVY_RAIN" ? 17 : 22, pitchCondition: stadium?.quality ?? 70 };
  }
  const previous = db.prepare("SELECT MAX(f.scheduled_at) AS lastMatch FROM fixture f WHERE f.status='COMPLETED' AND (f.home_club_id=? OR f.away_club_id=?) AND f.scheduled_at IS NOT NULL AND (? IS NULL OR f.scheduled_at<?)").get(clubId, clubId, fixture.scheduledAt, fixture.scheduledAt) as { lastMatch:string|null };
  const scheduledTime = fixture.scheduledAt ? new Date(fixture.scheduledAt).getTime() : NaN;
  const previousTime = previous.lastMatch ? new Date(previous.lastMatch).getTime() : NaN;
  const restHours = Number.isFinite(scheduledTime) && Number.isFinite(previousTime) ? Math.max(0, (scheduledTime-previousTime)/3600000-2) : 168;
  let travelKm = 0, travelHours = 0;
  if (clubId === fixture.away) {
    const origin = db.prepare("SELECT city_id AS cityId FROM club WHERE id=?").get(clubId) as { cityId:number|null } | undefined;
    const destination = db.prepare("SELECT city_id AS cityId FROM stadium WHERE id=?").get(fixture.stadiumId) as { cityId:number|null } | undefined;
    if (origin?.cityId != null && destination?.cityId != null && origin.cityId !== destination.cityId) {
      const route = db.prepare("SELECT distance_km AS distanceKm, estimated_hours AS estimatedHours FROM travel_route WHERE from_city_id=? AND to_city_id=?").get(origin.cityId,destination.cityId) as { distanceKm:number; estimatedHours:number } | undefined;
      travelKm = route?.distanceKm ?? 250;
      travelHours = route?.estimatedHours ?? Math.max(2,travelKm/75);
    }
  }
  return { ...environment, restHours, travelKm, travelHours };
}

export function persistMatchEnvironment(db: SqliteDatabase, fixtureId: number, context: MatchContext): void {
  db.prepare("INSERT INTO match_environment(fixture_id,weather,temperature_c,pitch_condition) VALUES(?,?,?,?) ON CONFLICT(fixture_id) DO NOTHING").run(fixtureId,context.weather,context.temperatureC,context.pitchCondition);
}

export function recoverSquadBeforeMatch(db: SqliteDatabase, fixtureId: number, homeClubId: number, awayClubId: number): void {
  const fixture = db.prepare("SELECT scheduled_at AS scheduledAt FROM fixture WHERE id=?").get(fixtureId) as { scheduledAt:string|null } | undefined;
  if (!fixture?.scheduledAt) return;
  const matchTime = new Date(fixture.scheduledAt).getTime();
  const rows = db.prepare("SELECT sm.player_id AS playerId, COALESCE(pc.energy,100) AS energy, MAX(f.scheduled_at) AS lastMatch FROM squad_membership sm LEFT JOIN player_condition pc ON pc.player_id=sm.player_id LEFT JOIN fixture f ON f.status='COMPLETED' AND (f.home_club_id=sm.club_id OR f.away_club_id=sm.club_id) AND f.scheduled_at IS NOT NULL AND f.scheduled_at<? WHERE sm.club_id IN (?,?) GROUP BY sm.player_id").all(fixture.scheduledAt,homeClubId,awayClubId) as Array<{playerId:number;energy:number;lastMatch:string|null}>;
  const update = db.prepare("UPDATE player_condition SET energy=MIN(100,energy+?) WHERE player_id=?");
  for (const player of rows) {
    const hours = player.lastMatch ? Math.max(0,(matchTime-new Date(player.lastMatch).getTime())/3600000-2) : 168;
    const recovery = Math.min(100-player.energy,Math.floor(hours/24)*8);
    if (recovery > 0) update.run(recovery,player.playerId);
  }
}
