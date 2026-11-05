import type { SqliteDatabase } from "../../db/database.js";
import {
  entityKey,
  localRef,
  lookupEntity,
  packageInstalledVersion,
  recordEntity,
} from "./entityService.js";
import { roundRobin } from "./roundRobin.js";
import { ensureDataPackageSchema } from "./schema.js";
import type {
  DataPackage,
  EntityType,
  InstallDataPackageResult,
} from "./types.js";
import {
  assert,
  compareVersions,
  positiveInt,
} from "./validationUtils.js";
import {
  validateDataPackage,
} from "./validator.js";


export function installDataPackage(
  db: SqliteDatabase,
  pkg: DataPackage
): InstallDataPackageResult {
  ensureDataPackageSchema(db);


  const errors = validateDataPackage(
    db,
    pkg
  );

  if (errors.length) {
    throw new Error(
      "Data package validation failed:\n- " +
      errors.join("\n- ")
    );
  }


  const installed = packageInstalledVersion(
    db,
    pkg.id
  );


  if (installed === pkg.version) {
    return {
      packageId: pkg.id,
      version: pkg.version,
      created: 0,
      updated: 0,
      stages: 0,
      fixtures: 0,
    };
  }


  if (
    installed &&
    compareVersions(
      pkg.version,
      installed
    ) <= 0
  ) {
    throw new Error(
      `Package ${pkg.id} version ${pkg.version} is not ` +
      `newer than installed version ${installed}.`
    );
  }


  const localCodes = new Map<
    string,
    number
  >();


  const result = db.transaction(() => {
    db
      .prepare(`
        INSERT INTO data_package_install (
          package_id,
          version,
          manifest_json
        )
        VALUES (?, ?, ?)

        ON CONFLICT(package_id)
        DO UPDATE SET
          version = excluded.version,
          manifest_json = excluded.manifest_json,
          installed_at = CURRENT_TIMESTAMP
      `)
      .run(
        pkg.id,
        pkg.version,
        JSON.stringify({
          id: pkg.id,
          version: pkg.version,
          schemaVersion: pkg.schemaVersion,
          dependencies:
            pkg.dependencies ?? [],
        })
      );


    let created = 0;
    let updated = 0;
    let stages = 0;
    let fixtures = 0;


    const remember = (
      type: EntityType,
      externalId: string,
      id: number
    ) => {
      localCodes.set(
        entityKey(type, externalId),
        id
      );

      recordEntity(
        db,
        pkg,
        type,
        externalId,
        id
      );
    };


    for (const item of pkg.nations ?? []) {
      const existing = db.prepare("SELECT id FROM nation WHERE code=?").get(item.code) as { id: number } | undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO nation(name,code) VALUES(?,?)").run(item.name, item.code).lastInsertRowid);
      if (existing) { db.prepare("UPDATE nation SET name=? WHERE id=?").run(item.name, id); updated++; } else created++;
      remember("nation", item.code, id);
    }
    for (const item of pkg.cities ?? []) {
      const nationId = localRef(db, pkg, "nation", item.nationCode, localCodes);
      const existing = db.prepare("SELECT id FROM city WHERE nation_id=? AND name=?").get(nationId, item.name) as { id: number } | undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO city(nation_id,name,climate_profile) VALUES(?,?,?)").run(nationId, item.name, item.climateProfile ?? "TEMPERATE").lastInsertRowid);
      if (existing) db.prepare("UPDATE city SET climate_profile=? WHERE id=?").run(item.climateProfile ?? "TEMPERATE", id);
      else created++;
      remember("city", item.code, id);
    }
    for (const item of pkg.clubs ?? []) {
      const nationId = localRef(db, pkg, "nation", item.nationCode, localCodes);
      const cityId = item.cityCode ? localRef(db, pkg, "city", item.cityCode, localCodes) : null;
      const existing = db.prepare("SELECT id FROM club WHERE nation_id=? AND name=?").get(nationId, item.name) as { id: number } | undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO club(nation_id,city_id,name,short_name,reputation,primary_color,secondary_color) VALUES(?,?,?,?,?,?,?)").run(nationId, cityId, item.name, item.shortName ?? item.code, item.reputation ?? 50, item.primaryColor ?? null, item.secondaryColor ?? null).lastInsertRowid);
      if (existing) { db.prepare("UPDATE club SET city_id=?,short_name=?,reputation=?,primary_color=?,secondary_color=? WHERE id=?").run(cityId, item.shortName ?? item.code, item.reputation ?? 50, item.primaryColor ?? null, item.secondaryColor ?? null, id); updated++; } else created++;
      remember("club", item.code, id);
      db.prepare("INSERT INTO team_tactic(club_id,formation_id) VALUES(?,(SELECT id FROM formation ORDER BY id LIMIT 1)) ON CONFLICT(club_id) DO NOTHING").run(id);
    }
    for (const item of pkg.stadiums ?? []) {
      const clubId = item.clubCode ? localRef(db, pkg, "club", item.clubCode, localCodes) : null;
      const cityId = item.cityCode ? localRef(db, pkg, "city", item.cityCode, localCodes) : null;
      const existing = db.prepare("SELECT id FROM stadium WHERE city_id IS ? AND name=?").get(cityId, item.name) as { id: number } | undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO stadium(club_id,city_id,name,capacity,pitch_quality) VALUES(?,?,?,?,?)").run(clubId, cityId, item.name, item.capacity ?? 10000, item.pitchQuality ?? 70).lastInsertRowid);
      if (existing) db.prepare("UPDATE stadium SET club_id=?,capacity=?,pitch_quality=? WHERE id=?").run(clubId, item.capacity ?? 10000, item.pitchQuality ?? 70, id);
      else created++;
      remember("stadium", item.code, id);
    }
    for (const item of pkg.players ?? []) {
      const nationId = item.nationalityCode ? localRef(db, pkg, "nation", item.nationalityCode, localCodes) : null;
      const existingId = lookupEntity(db, "player", item.code, pkg.id);
      let id: number;
      if (existingId) {
        id = existingId;
        db.prepare("UPDATE person SET full_name=?,birth_date=?,nationality_id=? WHERE id=?").run(item.name, item.birthDate ?? null, nationId, id);
        db.prepare("UPDATE player SET potential=?,preferred_foot=?,goalkeeper=? WHERE person_id=?").run(item.potential ?? 50, item.preferredFoot ?? "RIGHT", item.goalkeeper ? 1 : 0, id);
        updated++;
      } else {
        id = Number(db.prepare("INSERT INTO person(full_name,birth_date,nationality_id) VALUES(?,?,?)").run(item.name, item.birthDate ?? null, nationId).lastInsertRowid);
        db.prepare("INSERT INTO player(person_id,potential,preferred_foot,goalkeeper) VALUES(?,?,?,?)").run(id, item.potential ?? 50, item.preferredFoot ?? "RIGHT", item.goalkeeper ? 1 : 0);
        db.prepare("INSERT INTO player_attribute(player_id) VALUES(?)").run(id);
        db.prepare("INSERT INTO player_condition(player_id) VALUES(?)").run(id);
        created++;
      }
      const attrs = item.attributes ?? {};
      for (const [attribute, value] of Object.entries(attrs)) db.prepare(`UPDATE player_attribute SET ${attribute}=? WHERE player_id=?`).run(value, id);
      for (const position of item.positions ?? []) db.prepare("INSERT INTO player_position(player_id,position_code,rating) VALUES(?,?,?) ON CONFLICT(player_id,position_code) DO UPDATE SET rating=excluded.rating").run(id, position.code, position.rating);
      if (item.clubCode) {
        const clubId = localRef(db, pkg, "club", item.clubCode, localCodes);
        db.prepare("INSERT INTO squad_membership(player_id,club_id,shirt_number,squad_status) VALUES(?,?,?,?) ON CONFLICT(player_id) DO UPDATE SET club_id=excluded.club_id,shirt_number=excluded.shirt_number,squad_status=excluded.squad_status").run(id, clubId, item.shirtNumber ?? null, item.squadStatus ?? "FIRST_TEAM");
      }
      remember("player", item.code, id);
    }
    for (const competition of pkg.competitions ?? []) {
      const nationId = competition.nationCode ? localRef(db, pkg, "nation", competition.nationCode, localCodes) : null;
      const existing = db.prepare("SELECT id FROM competition WHERE code=?").get(competition.code) as { id: number } | undefined;
      const id = existing?.id ?? Number(db.prepare("INSERT INTO competition(nation_id,name,code,competition_kind) VALUES(?,?,?,?)").run(nationId, competition.name, competition.code, competition.kind ?? "LEAGUE").lastInsertRowid);
      if (existing) db.prepare("UPDATE competition SET nation_id=?,name=?,competition_kind=? WHERE id=?").run(nationId, competition.name, competition.kind ?? "LEAGUE", id);
      remember("competition", competition.code, id);
    }
    for (const competition of pkg.competitions ?? []) {
      const nationId = competition.nationCode ? localRef(db, pkg, "nation", competition.nationCode, localCodes) : null;
      const existing = db.prepare("SELECT id FROM competition WHERE code=?").get(competition.code) as { id: number } | undefined;
      const competitionId = existing?.id ?? Number(db.prepare("INSERT INTO competition(nation_id,name,code,competition_kind) VALUES(?,?,?,?)").run(nationId, competition.name, competition.code, competition.kind ?? "LEAGUE").lastInsertRowid);
      if (existing) { db.prepare("UPDATE competition SET nation_id=?,name=?,competition_kind=? WHERE id=?").run(nationId, competition.name, competition.kind ?? "LEAGUE", competitionId); updated++; } else created++;
      remember("competition", competition.code, competitionId);
      for (const season of competition.seasons) {
        const seasonExisting = db.prepare("SELECT id FROM competition_season WHERE competition_id=? AND season_year=?").get(competitionId, season.year) as { id: number } | undefined;
        const seasonId = seasonExisting?.id ?? Number(db.prepare("INSERT INTO competition_season(competition_id,season_year,start_date,end_date,status) VALUES(?,?,?,?,'PLANNED')").run(competitionId, season.year, season.startDate ?? null, season.endDate ?? null).lastInsertRowid);
        if (seasonExisting) { db.prepare("UPDATE competition_season SET start_date=?,end_date=? WHERE id=?").run(season.startDate ?? null, season.endDate ?? null, seasonId); updated++; } else created++;
        remember("season", `${competition.code}:${season.year}`, seasonId);
        db.prepare("DELETE FROM competition_entry WHERE season_id=?").run(seasonId);
        for (const stage of season.stages) {
          const stageKey = `${competition.code}:${season.year}:${stage.code}`;
          const stageExisting = db.prepare("SELECT id FROM competition_stage WHERE season_id=? AND stage_order=?").get(seasonId, stage.order) as { id: number } | undefined;
          const stageId = stageExisting?.id ?? Number(db.prepare("INSERT INTO competition_stage(season_id,name,stage_order,stage_kind) VALUES(?,?,?,?)").run(seasonId, stage.name, stage.order, stage.kind).lastInsertRowid);
          if (stageExisting) { db.prepare("UPDATE competition_stage SET name=?,stage_kind=? WHERE id=?").run(stage.name, stage.kind, stageId); updated++; } else created++;
          stages++;
          remember("stage", stageKey, stageId);
          const format = stage.format ?? {};
          db.prepare(`INSERT INTO stage_format(stage_id,group_count,legs,home_away,extra_time,penalties,away_goals_rule,win_points,draw_points,loss_points)
            VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(stage_id) DO UPDATE SET group_count=excluded.group_count,legs=excluded.legs,home_away=excluded.home_away,extra_time=excluded.extra_time,penalties=excluded.penalties,away_goals_rule=excluded.away_goals_rule,win_points=excluded.win_points,draw_points=excluded.draw_points,loss_points=excluded.loss_points`)
            .run(stageId, format.groupCount ?? 1, format.legs ?? 1, format.homeAway === false ? 0 : 1, format.extraTime ? 1 : 0, format.penalties ? 1 : 0, format.awayGoalsRule ? 1 : 0, format.winPoints ?? 3, format.drawPoints ?? 1, format.lossPoints ?? 0);
          const groups = stage.groups?.length ? stage.groups : [{ code: "A", name: "Grupo A" }];
          for (let i = 0; i < groups.length; i++) db.prepare("INSERT INTO stage_group(stage_id,group_code,name,sort_order) VALUES(?,?,?,?) ON CONFLICT(stage_id,group_code) DO UPDATE SET name=excluded.name,sort_order=excluded.sort_order").run(stageId, groups[i]!.code, groups[i]!.name, i + 1);
          db.prepare("DELETE FROM stage_standing_rule WHERE stage_id=?").run(stageId);
          for (const [index, rule] of (stage.standingsRules ?? ["POINTS", "GOAL_DIFFERENCE", "GOALS_FOR", "HEAD_TO_HEAD"]).entries()) db.prepare("INSERT INTO stage_standing_rule(stage_id,rule_order,rule_key) VALUES(?,?,?)").run(stageId, index + 1, rule);
          db.prepare("DELETE FROM stage_participant WHERE stage_id=?").run(stageId);
          db.prepare("DELETE FROM stage_standing WHERE stage_id=?").run(stageId);
          const groupRows = db.prepare("SELECT id,group_code FROM stage_group WHERE stage_id=?").all(stageId) as Array<{ id: number; group_code: string }>;
          const groupIds = new Map(groupRows.map(g => [g.group_code, g.id]));
          for (const [index, participant] of stage.participants.entries()) {
            const clubId = localRef(db, pkg, "club", participant.clubCode, localCodes);
            const groupId = groupIds.get(participant.groupCode ?? groups[0]!.code);
            assert(groupId !== undefined, `Undefined group ${participant.groupCode} in stage ${stage.code}.`);
            db.prepare("INSERT INTO stage_participant(stage_id,club_id,group_id,seed) VALUES(?,?,?,?)").run(stageId, clubId, groupId, participant.seed ?? index + 1);
            db.prepare("INSERT INTO stage_standing(stage_id,club_id,group_id) VALUES(?,?,?)").run(stageId, clubId, groupId);
            db.prepare("INSERT INTO competition_entry(season_id,club_id,seed) VALUES(?,?,?) ON CONFLICT(season_id,club_id) DO UPDATE SET seed=excluded.seed").run(seasonId, clubId, participant.seed ?? index + 1);
          }
          db.prepare("INSERT INTO schedule_profile(stage_id) VALUES(?) ON CONFLICT(stage_id) DO NOTHING").run(stageId);
          const oldFixtures = db.prepare("SELECT f.status FROM fixture f JOIN competition_round r ON r.id=f.round_id WHERE r.stage_id=?").all(stageId) as Array<{ status: string }>;
          assert(oldFixtures.every(f => f.status === "SCHEDULED"), `Cannot replace the calendar for stage ${stage.code} after matches have started.`);
          db.prepare("DELETE FROM competition_round WHERE stage_id=?").run(stageId);
          let rounds = stage.calendar;
          if (!rounds) {
            rounds = [];
            if (stage.kind === "LEAGUE" || stage.kind === "GROUPS") {
              for (const group of groups) {
                const ids = stage.participants.filter(p => (p.groupCode ?? groups[0]!.code) === group.code).map(p => localRef(db, pkg, "club", p.clubCode, localCodes));
                const generated = roundRobin(ids, format.legs ?? 1);
                generated.forEach((fixtures, ri) => {
                  const roundNumber = ri + 1;
                  const existingRound = rounds!.find(r => r.number === roundNumber);
                  const mapped = fixtures.map(f => ({ homeClubCode: stage.participants.find(p => localRef(db, pkg, "club", p.clubCode, localCodes) === f.home)!.clubCode, awayClubCode: stage.participants.find(p => localRef(db, pkg, "club", p.clubCode, localCodes) === f.away)!.clubCode }));
                  if (existingRound) existingRound.fixtures.push(...mapped);
                  else rounds!.push({ number: roundNumber, name: `Rodada ${roundNumber}`, fixtures: mapped });
                });
              }
            } else {
              const seeded = [...stage.participants].sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999));
              rounds.push({ number: 1, name: stage.name, fixtures: Array.from({ length: Math.floor(seeded.length / 2) }, (_, i) => ({ homeClubCode: seeded[i]!.clubCode, awayClubCode: seeded[seeded.length - 1 - i]!.clubCode })) });
            }
          }
          const insertRound = db.prepare("INSERT INTO competition_round(stage_id,round_number,name,start_date,end_date) VALUES(?,?,?,?,?)");
          const insertFixture = db.prepare("INSERT INTO fixture(round_id,home_club_id,away_club_id,stadium_id,scheduled_at,random_seed) VALUES(?,?,?,?,?,?)");
          for (const round of rounds.sort((a, b) => a.number - b.number)) {
            const baseDate = season.startDate ?? `${season.year}-01-10`;
            const roundDate = new Date(`${baseDate}T00:00:00Z`);
            roundDate.setUTCDate(roundDate.getUTCDate() + (round.number - 1) * 7);
            const date = round.date ?? roundDate.toISOString().slice(0, 10);
            const roundId = Number(insertRound.run(stageId, round.number, round.name ?? `Rodada ${round.number}`, date, date).lastInsertRowid);
            for (const [fixtureIndex, fixture] of round.fixtures.entries()) {
              const home = localRef(db, pkg, "club", fixture.homeClubCode, localCodes), away = localRef(db, pkg, "club", fixture.awayClubCode, localCodes);
              assert(home !== away, `Fixture in stage ${stage.code} has same home and away club.`);
              const stadiumId = fixture.stadiumCode ? localRef(db, pkg, "stadium", fixture.stadiumCode, localCodes) : (db.prepare("SELECT id FROM stadium WHERE club_id=? ORDER BY id LIMIT 1").get(home) as { id: number } | undefined)?.id ?? null;
              insertFixture.run(roundId, home, away, stadiumId, fixture.date ?? `${date}T${String(16 + (fixtureIndex % 4) * 2).padStart(2, "0")}:00:00`, ((season.year * 100000) + (round.number * 100) + fixtureIndex + 1) >>> 0);
              fixtures++;
            }
          }
          db.prepare("DELETE FROM promotion_relegation_rule WHERE source_stage_id=?").run(stageId);
          for (const movement of stage.promotionRelegation ?? []) {
            const targetCompetitionId = movement.targetCompetitionCode ? localRef(db, pkg, "competition", movement.targetCompetitionCode, localCodes) : null;
            db.prepare("INSERT INTO promotion_relegation_rule(source_stage_id,position_from,position_to,movement_type,target_competition_id,target_stage_id,target_tier,priority) VALUES(?,?,?,?,?,NULL,?,?)")
              .run(stageId, movement.positionFrom, movement.positionTo, movement.movementType, targetCompetitionId, movement.targetTier ?? null, movement.priority ?? 100);
          }
        }
      }
    }
    for (const competition of pkg.competitions ?? []) {
      const competitionId = localRef(db, pkg, "competition", competition.code, localCodes);
      const tier = competition.tier;
      if (tier !== undefined) { positiveInt(tier, "competition.tier"); db.prepare("INSERT INTO data_package_competition_tier(competition_id,tier,package_id) VALUES(?,?,?) ON CONFLICT(competition_id) DO UPDATE SET tier=excluded.tier,package_id=excluded.package_id").run(competitionId, tier, pkg.id); }
    }


    return {
      packageId: pkg.id,
      version: pkg.version,
      created,
      updated,
      stages,
      fixtures,
    };
  });


  return result();
}