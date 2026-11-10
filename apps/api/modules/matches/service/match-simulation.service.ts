import type {
    SqliteDatabase,
} from "../../../db/database.js";
import { applyMigrations } from "../../../db/migrations.js";
import {
    persistMatchEnvironment,
    recoverSquadBeforeMatch,
    resolveMatchContext,
} from "./match-context.service.js";
import {
    loadTeam,
} from "../engine/teamService.js";
import {
    simulateMatchTimeline,
} from "../engine/timelineSimulator.js";
import type {
    FixtureRow,
    KernelMinute,
    MatchSummary,
    TacticalChange,
} from "../types/match-engine.types.js";


function readMatchSummary(db: SqliteDatabase, fixtureId: number, minutes: number): MatchSummary {
    const fixture = db.prepare("SELECT home_club_id AS homeClubId,away_club_id AS awayClubId FROM fixture WHERE id=?").get(fixtureId) as {homeClubId:number;awayClubId:number};
    const actual = db.prepare("SELECT club_id AS club,event_type AS type,COALESCE(SUM(xg),0) AS xg,COUNT(*) AS count FROM match_event WHERE fixture_id=? AND club_id IS NOT NULL GROUP BY club_id,event_type").all(fixtureId) as Array<{club:number;type:string;xg:number;count:number}>;
    const metric = (club:number, types:string[]) => actual.filter(event=>event.club===club&&types.includes(event.type)).reduce((total,event)=>total+event.count,0);
    const xg = (club:number) => actual.filter(event=>event.club===club&&["GOAL","SAVE","MISS"].includes(event.type)).reduce((total,event)=>total+event.xg,0);
    const events = (db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=?").get(fixtureId) as {count:number}).count;
    return {
      fixtureId,homeClubId:fixture.homeClubId,awayClubId:fixture.awayClubId,
      homeScore:metric(fixture.homeClubId,["GOAL"]),awayScore:metric(fixture.awayClubId,["GOAL"]),
      homeShots:metric(fixture.homeClubId,["GOAL","SAVE","MISS"]),awayShots:metric(fixture.awayClubId,["GOAL","SAVE","MISS"]),
      homeShotsOnTarget:metric(fixture.homeClubId,["GOAL","SAVE"]),awayShotsOnTarget:metric(fixture.awayClubId,["GOAL","SAVE"]),
      homeXg:xg(fixture.homeClubId),awayXg:xg(fixture.awayClubId),
      homeFouls:metric(fixture.homeClubId,["FOUL"]),awayFouls:metric(fixture.awayClubId,["FOUL"]),
      homeYellowCards:metric(fixture.homeClubId,["YELLOW_CARD"]),awayYellowCards:metric(fixture.awayClubId,["YELLOW_CARD"]),
      homeRedCards:metric(fixture.homeClubId,["RED_CARD"]),awayRedCards:metric(fixture.awayClubId,["RED_CARD"]),
      homeSubstitutions:metric(fixture.homeClubId,["SUBSTITUTION"]),awaySubstitutions:metric(fixture.awayClubId,["SUBSTITUTION"]),
      homeInjuries:metric(fixture.homeClubId,["INJURY"]),awayInjuries:metric(fixture.awayClubId,["INJURY"]),
      events,minutes,
    };
}

export function simulateMatch(
    db: SqliteDatabase,
    fixtureId: number,
    throughMinute = 90,
): MatchSummary {
    // Match simulation may also run against disposable or imported databases that
    // bypass SaveManager.open; migrate them before touching versioned match tables.
    applyMigrations(db);
    if (!Number.isSafeInteger(throughMinute) || throughMinute < 1 || throughMinute > 90) throw new Error("throughMinute must be an integer between 1 and 90.");
    const f = db.prepare("SELECT id,home_club_id,away_club_id,random_seed,status FROM fixture WHERE id=?").get(fixtureId) as FixtureRow | undefined;
    if (!f) throw new Error(`Fixture ${fixtureId} not found.`);
    if (f.status === "COMPLETED") throw new Error(`Fixture ${fixtureId} is already completed.`);
    if (f.status === "CANCELLED" || f.status === "POSTPONED") throw new Error(`Fixture ${fixtureId} is not playable (status: ${f.status}).`);
    if (f.status !== "SCHEDULED" && f.status !== "IN_PROGRESS") throw new Error(`Fixture ${fixtureId} cannot be played from status ${f.status}.`);
    const seed = f.random_seed ?? (f.id * 2654435761 >>> 0);
    const hasCheckpoint = Boolean(db.prepare("SELECT 1 FROM match_simulation_state WHERE fixture_id=?").get(fixtureId));
    if (!hasCheckpoint) recoverSquadBeforeMatch(db, fixtureId, f.home_club_id, f.away_club_id);
    const context = resolveMatchContext(db, fixtureId, f.home_club_id);
    persistMatchEnvironment(db, fixtureId, context);
    const home = loadTeam(db, fixtureId, f.home_club_id), away = loadTeam(db, fixtureId, f.away_club_id);
    const changes = db.prepare("SELECT id,minute,club_id,change_type,payload FROM match_tactical_change WHERE fixture_id=? ORDER BY minute,id").all(fixtureId) as TacticalChange[];
    const initiallyStartingPlayerIds = new Set([...home.lineup, ...away.lineup].filter(player => player.isStarting).map(player => player.id));
    const collectMomentumTrace = process.env.MOMENTUM_DEBUG === "true";
    const timeline = simulateMatchTimeline(
        home, away, seed, changes,
        { collectMomentumTrace },
    );
    const simulationConfig = {
        home: {
            clubId: home.clubId, tactic: home.tactic, context: home.context,
            lineup: home.lineup.map(p => ({ id: p.id, role: p.role, slot: p.slot, isStarting: p.isStarting, positionRating: p.positionRating }))
        },
        away: {
            clubId: away.clubId, tactic: away.tactic, context: away.context,
            lineup: away.lineup.map(p => ({ id: p.id, role: p.role, slot: p.slot, isStarting: p.isStarting, positionRating: p.positionRating }))
        },
        tacticalChanges: changes.map(change => ({ id: change.id, minute: change.minute, clubId: change.club_id, type: change.change_type, payload: change.payload })),
    };
    const existing = db.prepare("SELECT simulation_minute,state_json FROM match_simulation_state WHERE fixture_id=?")
        .get(fixtureId) as { simulation_minute: number; state_json: string } | undefined;
    let startMinute = existing?.simulation_minute ?? 0;
    if (existing) {
        let checkpoint: { seed?: number; completed?: boolean; config?: unknown };
        try { checkpoint = JSON.parse(existing.state_json) as { seed?: number; completed?: boolean }; }
        catch { throw new Error(`Fixture ${fixtureId} has an invalid simulation checkpoint; refusing to overwrite it.`); }
        if (checkpoint.seed !== seed) throw new Error(`Fixture ${fixtureId} checkpoint seed does not match its fixture seed.`);
        if (checkpoint.config !== undefined) {
            const previous = checkpoint.config as {
                home?: unknown;
                away?: unknown;
                tacticalChanges?: Array<{ id: number; minute: number; clubId: number; type: string; payload: string }>;
            };
            const sameTeams = JSON.stringify({ home: previous.home, away: previous.away }) ===
                JSON.stringify({ home: simulationConfig.home, away: simulationConfig.away });
            const previousChanges = previous.tacticalChanges ?? [];
            const currentChanges = simulationConfig.tacticalChanges;
            const previousChangeIds = new Set(previousChanges.map(change => change.id));
            const newChanges = currentChanges.filter(change => !previousChangeIds.has(change.id));
            const changedExistingInputs = previousChanges.some(previousChange => {
                const current = currentChanges.find(change => change.id === previousChange.id);
                return !current ||
                    current.minute !== previousChange.minute ||
                    current.clubId !== previousChange.clubId ||
                    current.type !== previousChange.type ||
                    current.payload !== previousChange.payload;
            });
            const onlyFutureChangesWereAdded = newChanges.every(change => change.minute > startMinute);
            if (!sameTeams || changedExistingInputs || !onlyFutureChangesWereAdded) {
                throw new Error(`Fixture ${fixtureId} simulation inputs changed after its checkpoint; only new tactical changes scheduled after minute ${startMinute} can be appended.`);
            }
            // Future decisions are append-only. Promote the new input snapshot
            // before processing another minute so subsequent resumes stay deterministic.
            if (newChanges.length > 0) {
                const updatedConfig = simulationConfig;
                const minuteCheckpoint = db.prepare(
                    "SELECT simulation_minute AS minute,state_json AS stateJson FROM match_simulation_state WHERE fixture_id=?",
                ).get(fixtureId) as { minute:number; stateJson:string } | undefined;
                if (!minuteCheckpoint || minuteCheckpoint.minute !== startMinute) {
                    throw new Error(`Fixture ${fixtureId} checkpoint changed while tactical decisions were being scheduled.`);
                }
                const persistedCheckpoint = JSON.parse(minuteCheckpoint.stateJson) as Record<string, unknown>;
                db.prepare("UPDATE match_simulation_state SET state_json=? WHERE fixture_id=? AND simulation_minute=?")
                    .run(JSON.stringify({ ...persistedCheckpoint, config: updatedConfig }), fixtureId, startMinute);
            }
        }
        if (startMinute < 0 || startMinute > 90) throw new Error(`Fixture ${fixtureId} checkpoint minute is invalid.`);
    } else if (f.status === "IN_PROGRESS") {
        throw new Error(`Fixture ${fixtureId} is IN_PROGRESS but has no checkpoint; manual repair is required.`);
    }
    if (!existing) {
        const begin = db.transaction(() => {
            // Acquire the write lock before checking the transition. A concurrent caller
            // must never reset another worker's checkpoint/events after it has started.
            const current = db.prepare("SELECT status FROM fixture WHERE id=?").get(fixtureId) as { status: string } | undefined;
            if (!current || current.status !== "SCHEDULED") throw new Error(`Fixture ${fixtureId} changed state before simulation could start.`);
            if (db.prepare("SELECT 1 FROM match_simulation_state WHERE fixture_id=?").get(fixtureId)) {
                throw new Error(`Fixture ${fixtureId} already has a simulation checkpoint; refusing destructive reinitialization.`);
            }
            db.prepare("INSERT INTO match_event(fixture_id,minute,event_type,xg,description) VALUES(?,0,'KICK_OFF',0,'Partida iniciada')").run(fixtureId);
            const lineupSnapshot = (team: typeof home) => team.lineup.map(player => ({
                playerId: player.id, name: player.name, position: player.role, slot: player.slot,
                isStarting: player.isStarting, energy: player.energy, morale: player.morale, sharpness: player.sharpness,
            }));
            const clubNames = db.prepare("SELECT id,name FROM club WHERE id IN (?,?)").all(home.clubId,away.clubId) as Array<{id:number;name:string}>;
            const clubNameById = new Map(clubNames.map(club => [club.id,club.name]));
            const formationNames = db.prepare("SELECT id,name FROM formation WHERE id IN (?,?)").all(home.tactic.formation_id,away.tactic.formation_id) as Array<{id:number;name:string}>;
            const formationNameById = new Map(formationNames.map(formation => [formation.id,formation.name]));
            const tacticsSnapshot = {
                home: { clubId: home.clubId, clubName: clubNameById.get(home.clubId) ?? String(home.clubId), tactic: { ...home.tactic, formation_name: formationNameById.get(home.tactic.formation_id) ?? String(home.tactic.formation_id) }, context: home.context ?? null },
                away: { clubId: away.clubId, clubName: clubNameById.get(away.clubId) ?? String(away.clubId), tactic: { ...away.tactic, formation_name: formationNameById.get(away.tactic.formation_id) ?? String(away.tactic.formation_id) }, context: away.context ?? null },
                scheduledChanges: simulationConfig.tacticalChanges,
            };
            db.prepare(`INSERT INTO match_history_snapshot(
                fixture_id,home_lineup_json,away_lineup_json,tactics_json,engine_version,random_seed
            ) VALUES(?,?,?,?,?,?)`).run(
                fixtureId, JSON.stringify(lineupSnapshot(home)), JSON.stringify(lineupSnapshot(away)),
                JSON.stringify(tacticsSnapshot), "1.0.0", seed,
            );
            db.prepare("INSERT INTO match_simulation_state(fixture_id,state_version,simulation_minute,state_json) VALUES(?,1,0,?)")
                .run(fixtureId, JSON.stringify({ engineVersion: "1.0.0", seed, config: simulationConfig, minute: 0, homeScore: 0, awayScore: 0, completed: false }));
            const claimed = db.prepare("UPDATE fixture SET status='IN_PROGRESS',random_seed=?,current_minute=0,home_score=0,away_score=0 WHERE id=? AND status='SCHEDULED'").run(seed, fixtureId);
            if (claimed.changes !== 1) throw new Error(`Fixture ${fixtureId} could not be claimed for simulation.`);
        });
        begin.immediate();
    }
    const hasHistorySnapshot = Boolean(db.prepare("SELECT 1 FROM match_history_snapshot WHERE fixture_id=?").get(fixtureId));
    if (!hasHistorySnapshot) {
        // Legacy in-progress saves may have a checkpoint created before kickoff snapshots existed.
        // Preserve the best available persisted inputs, explicitly marking them as reconstructed.
        const lineupSnapshot = (team: typeof home) => team.lineup.map(player => ({
            playerId:player.id,name:player.name,position:player.role,slot:player.slot,isStarting:player.isStarting,
            energy:player.energy,morale:player.morale,sharpness:player.sharpness,
        }));
        const clubNames = db.prepare("SELECT id,name FROM club WHERE id IN (?,?)").all(home.clubId,away.clubId) as Array<{id:number;name:string}>;
        const clubNameById = new Map(clubNames.map(club => [club.id,club.name]));
        const formationNames = db.prepare("SELECT id,name FROM formation WHERE id IN (?,?)").all(home.tactic.formation_id,away.tactic.formation_id) as Array<{id:number;name:string}>;
        const formationNameById = new Map(formationNames.map(formation => [formation.id,formation.name]));
        const tacticsSnapshot = {
            home:{clubId:home.clubId,clubName:clubNameById.get(home.clubId) ?? String(home.clubId),tactic:{...home.tactic,formation_name:formationNameById.get(home.tactic.formation_id) ?? String(home.tactic.formation_id)},context:home.context ?? null},
            away:{clubId:away.clubId,clubName:clubNameById.get(away.clubId) ?? String(away.clubId),tactic:{...away.tactic,formation_name:formationNameById.get(away.tactic.formation_id) ?? String(away.tactic.formation_id)},context:away.context ?? null},
            scheduledChanges:simulationConfig.tacticalChanges,
        };
        db.prepare("INSERT INTO match_history_snapshot(fixture_id,home_lineup_json,away_lineup_json,tactics_json,engine_version,random_seed,is_legacy) VALUES(?,?,?,?,?,?,1)").run(
            fixtureId,JSON.stringify(lineupSnapshot(home)),JSON.stringify(lineupSnapshot(away)),JSON.stringify(tacticsSnapshot),"1.0.0",seed,
        );
    }
    const insertEvent = db.prepare("INSERT INTO match_event(fixture_id,minute,club_id,player_id,secondary_player_id,event_type,xg,description) VALUES(?,?,?,?,?,?,?,?)");
    const insertMomentum = db.prepare(`INSERT INTO match_momentum(
        fixture_id,minute,home_pressure,away_pressure,home_score,away_score,
        home_territorial_control,away_territorial_control,
        home_offensive_threat,away_offensive_threat,
        home_defensive_stability,away_defensive_stability,
        home_intensity,away_intensity,
        home_physical_condition,away_physical_condition
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const checkpoint = db.prepare("UPDATE match_simulation_state SET simulation_minute=?,state_json=?,updated_at=CURRENT_TIMESTAMP WHERE fixture_id=?");
    const insertMomentumTrace = collectMomentumTrace
        ? db.prepare("INSERT OR REPLACE INTO match_momentum_debug(fixture_id,minute,trace_json) VALUES(?,?,?)")
        : null;
    const minuteUpdate = db.transaction((m: KernelMinute) => {
        for (const e of m.events) insertEvent.run(fixtureId, e.minute, e.clubId, e.playerId || null, e.secondaryPlayerId, e.eventType, e.xg, e.description);
        insertMomentum.run(
            fixtureId, m.minute, m.homePressure, m.awayPressure, m.homeScore, m.awayScore,
            m.homeState.territorialControl, m.awayState.territorialControl,
            m.homeState.offensiveThreat, m.awayState.offensiveThreat,
            m.homeState.defensiveStability, m.awayState.defensiveStability,
            m.homeState.intensity, m.awayState.intensity,
            m.homeState.physicalCondition, m.awayState.physicalCondition,
        );
        if (m.momentumTrace && insertMomentumTrace) {
            insertMomentumTrace.run(fixtureId, m.minute, JSON.stringify(m.momentumTrace));
        }
        checkpoint.run(m.minute, JSON.stringify({
            engineVersion: "1.0.0", seed, config: simulationConfig, minute: m.minute, homeScore: m.homeScore, awayScore: m.awayScore,
            homeShots: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.home_club_id && ["GOAL", "SAVE", "MISS"].includes(e.eventType)).length,
            awayShots: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.away_club_id && ["GOAL", "SAVE", "MISS"].includes(e.eventType)).length,
            homeShotsOnTarget: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.home_club_id && (e.eventType === "GOAL" || e.eventType === "SAVE")).length,
            awayShotsOnTarget: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.away_club_id && (e.eventType === "GOAL" || e.eventType === "SAVE")).length,
            homePressure: m.homePressure, awayPressure: m.awayPressure,
            homeState: m.homeState, awayState: m.awayState,
            homeXg: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.home_club_id && ["GOAL", "SAVE", "MISS"].includes(e.eventType)).reduce((n, e) => n + e.xg, 0),
            awayXg: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.away_club_id && ["GOAL", "SAVE", "MISS"].includes(e.eventType)).reduce((n, e) => n + e.xg, 0),
            completed: false
        }), fixtureId);
        db.prepare("UPDATE fixture SET status='IN_PROGRESS',current_minute=?,home_score=?,away_score=? WHERE id=?")
            .run(m.minute, m.homeScore, m.awayScore, fixtureId);
    });
    for (const m of timeline.minutes) if (m.minute > startMinute && m.minute <= throughMinute) minuteUpdate.immediate(m);
    const currentMinute = Math.max(startMinute, Math.min(throughMinute, 90));
    if (currentMinute < 90) return readMatchSummary(db, fixtureId, currentMinute);
    const finalise = db.transaction(() => {
        const alreadyFullTime = db.prepare("SELECT 1 FROM match_event WHERE fixture_id=? AND event_type='FULL_TIME'").get(fixtureId);
        if (!alreadyFullTime) insertEvent.run(fixtureId, 90, null, null, null, "FULL_TIME", 0, "Fim de jogo");
        db.prepare("DELETE FROM match_player_state WHERE fixture_id=?").run(fixtureId);
        db.prepare("UPDATE match_tactical_change SET applied=1 WHERE fixture_id=?").run(fixtureId);
        const state = db.prepare("INSERT INTO match_player_state(fixture_id,player_id,club_id,energy,rating,minutes_played,goals,assists,yellow_cards,red_card,substituted_out) VALUES(?,?,?,?,?,?,?,?,?,?,?)");
        for (const team of [home, away]) for (const p of team.lineup) {
            const playerEvents = timeline.events.filter(event => event.playerId === p.id || event.secondaryPlayerId === p.id);
            const exits = playerEvents.filter(event =>
                (event.eventType === "SUBSTITUTION" && event.playerId === p.id) ||
                event.eventType === "INJURY" ||
                event.eventType === "RED_CARD"
            ).sort((a, b) => a.minute - b.minute);
            const substitutionIn = timeline.events.find(event => event.eventType === "SUBSTITUTION" && event.secondaryPlayerId === p.id);
            const exitEvent = exits[0];
            const wasStarter = initiallyStartingPlayerIds.has(p.id);
            const minutesPlayed = wasStarter
                ? Math.max(0, exitEvent?.minute ?? 90)
                : substitutionIn
                    ? Math.max(0, (exitEvent && exitEvent.minute > substitutionIn.minute ? exitEvent.minute : 90) - substitutionIn.minute)
                    : 0;
            const loss = minutesPlayed === 0 ? 2 : wasStarter ? (exitEvent ? 9 : 14) : 7;
            const goals = timeline.events.filter(event => event.eventType === "GOAL" && event.playerId === p.id).length;
            const assists = timeline.events.filter(event => event.eventType === "GOAL" && event.secondaryPlayerId === p.id).length;
            const yellowCards = timeline.events.filter(event => event.eventType === "YELLOW_CARD" && event.playerId === p.id).length;
            const redCard = timeline.events.some(event => event.eventType === "RED_CARD" && event.playerId === p.id);
            const substitutedOut = timeline.events.some(event => event.eventType === "SUBSTITUTION" && event.playerId === p.id);
            const rating = Math.max(4, Math.min(10, (wasStarter ? 6.3 : 6) + goals * 0.8 + assists * 0.5 - yellowCards * 0.3 - (redCard ? 1.5 : 0)));
            state.run(fixtureId, p.id, team.clubId, Math.max(0, p.energy - loss), rating, minutesPlayed,
                goals, assists, yellowCards, redCard ? 1 : 0, substitutedOut ? 1 : 0);
            db.prepare("UPDATE player_condition SET energy=MAX(0,energy-?) WHERE player_id=?").run(loss, p.id);
            if (minutesPlayed > 0) {
                const delta = timeline.result.homeScore === timeline.result.awayScore ? 0 :
                    (team.clubId === f.home_club_id ? (timeline.result.homeScore > timeline.result.awayScore ? 2 : -2) :
                        (timeline.result.awayScore > timeline.result.homeScore ? 2 : -2));
                db.prepare("UPDATE player_condition SET morale=MIN(100,MAX(0,morale+?)) WHERE player_id=?").run(delta, p.id);
            }
        }
        db.prepare("UPDATE player_condition SET suspension_matches=MAX(0,suspension_matches-1) WHERE player_id IN (SELECT player_id FROM squad_membership WHERE club_id IN (?,?)) AND suspension_matches>0").run(f.home_club_id, f.away_club_id);
        for (const incident of timeline.events.filter(event => event.eventType === "INJURY" && event.playerId > 0)) {
            db.prepare("UPDATE player_condition SET injured_until=COALESCE(date((SELECT substr(scheduled_at,1,10) FROM fixture WHERE id=?),'+'||?||' days'),date('now','+'||?||' days')) WHERE player_id=?")
                .run(fixtureId, incident.injuryDays ?? 7, incident.injuryDays ?? 7, incident.playerId);
        }
        for (const incident of timeline.events.filter(event => event.eventType === "RED_CARD" && event.playerId > 0)) {
            db.prepare("UPDATE player_condition SET suspension_matches=MAX(suspension_matches,1) WHERE player_id=?").run(incident.playerId);
        }
        const yellowPlayers = [...new Set(timeline.events.filter(event => event.eventType === "YELLOW_CARD" && event.playerId > 0).map(event => event.playerId))];
        for (const playerId of yellowPlayers) {
            const count = (db.prepare(`SELECT COUNT(*) AS count FROM match_event e
      JOIN fixture f ON f.id=e.fixture_id JOIN competition_round r ON r.id=f.round_id
      JOIN competition_stage st ON st.id=r.stage_id
      WHERE e.player_id=? AND e.event_type='YELLOW_CARD'
        AND st.season_id=(SELECT st2.season_id FROM fixture f2 JOIN competition_round r2 ON r2.id=f2.round_id JOIN competition_stage st2 ON st2.id=r2.stage_id WHERE f2.id=?)
        AND (f.status='COMPLETED' OR f.id=?)`).get(playerId, fixtureId, fixtureId) as { count: number }).count;
            if (count > 0 && count % 5 === 0) db.prepare("UPDATE player_condition SET suspension_matches=MAX(suspension_matches,1) WHERE player_id=?").run(playerId);
        }
        const momentumCount = (db.prepare("SELECT COUNT(*) AS count FROM match_momentum WHERE fixture_id=?").get(fixtureId) as { count:number }).count;
        if (momentumCount !== 90) throw new Error(`Fixture ${fixtureId} cannot be finalized: expected 90 momentum samples, found ${momentumCount}.`);
        const eventRows = db.prepare("SELECT club_id AS clubId,event_type AS type,COALESCE(xg,0) AS xg FROM match_event WHERE fixture_id=?").all(fixtureId) as Array<{clubId:number|null;type:string;xg:number}>;
        const summarize = (clubId:number) => {
            const count = (types:string[]) => eventRows.filter(event => event.clubId === clubId && types.includes(event.type)).length;
            return { goals:count(["GOAL"]), shots:count(["GOAL","SAVE","MISS"]), shotsOnTarget:count(["GOAL","SAVE"]),
                expectedGoals:eventRows.filter(event => event.clubId === clubId && ["GOAL","SAVE","MISS"].includes(event.type)).reduce((sum,event) => sum + event.xg,0),
                fouls:count(["FOUL"]), yellowCards:count(["YELLOW_CARD"]), redCards:count(["RED_CARD"]),
                substitutions:count(["SUBSTITUTION"]), injuries:count(["INJURY"]) };
        };
        const historySnapshot = db.prepare("SELECT result_json AS resultJson FROM match_history_snapshot WHERE fixture_id=?").get(fixtureId) as {resultJson:string|null}|undefined;
        if (!historySnapshot || historySnapshot.resultJson !== null) throw new Error(`Fixture ${fixtureId} is missing its kickoff snapshot or already has finalized history.`);
        const resultSnapshot = { home:summarize(f.home_club_id), away:summarize(f.away_club_id), eventCount:eventRows.length, momentumCount, homeScore:timeline.result.homeScore, awayScore:timeline.result.awayScore };
        db.prepare("UPDATE match_history_snapshot SET result_json=?,completed_at=CURRENT_TIMESTAMP WHERE fixture_id=? AND result_json IS NULL").run(JSON.stringify(resultSnapshot), fixtureId);
        db.prepare("UPDATE fixture SET status='COMPLETED',current_minute=90,home_score=?,away_score=?,completed_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(timeline.result.homeScore, timeline.result.awayScore, fixtureId);
        checkpoint.run(90, JSON.stringify({
            engineVersion: "1.0.0", seed, config: simulationConfig, minute: 90, homeScore: timeline.result.homeScore,
            awayScore: timeline.result.awayScore, homeShots: timeline.result.homeShots, awayShots: timeline.result.awayShots,
            homeXg: timeline.result.homeXg, awayXg: timeline.result.awayXg, completed: true
        }), fixtureId);
    });
    finalise.immediate();
    const actual = db.prepare("SELECT club_id AS club,event_type AS type,COALESCE(SUM(xg),0) AS xg,COUNT(*) AS count FROM match_event WHERE fixture_id=? AND club_id IS NOT NULL GROUP BY club_id,event_type").all(fixtureId) as Array<{ club: number; type: string; xg: number; count: number }>;
    const metric = (club: number, types: string[]) => actual.filter(e => e.club === club && types.includes(e.type)).reduce((n, e) => n + e.count, 0);
    const xg = (club: number) => actual.filter(e => e.club === club && ["GOAL", "SAVE", "MISS"].includes(e.type)).reduce((n, e) => n + e.xg, 0);
    const count = (db.prepare("SELECT COUNT(*) AS count FROM match_event WHERE fixture_id=?").get(fixtureId) as { count: number }).count;
    return {
        fixtureId, homeClubId: f.home_club_id, awayClubId: f.away_club_id,
        homeScore: metric(f.home_club_id, ["GOAL"]), awayScore: metric(f.away_club_id, ["GOAL"]),
        homeShots: metric(f.home_club_id, ["GOAL", "SAVE", "MISS"]), awayShots: metric(f.away_club_id, ["GOAL", "SAVE", "MISS"]),
        homeShotsOnTarget: metric(f.home_club_id, ["GOAL", "SAVE"]), awayShotsOnTarget: metric(f.away_club_id, ["GOAL", "SAVE"]),
        homeXg: xg(f.home_club_id), awayXg: xg(f.away_club_id),
        homeFouls: metric(f.home_club_id, ["FOUL"]), awayFouls: metric(f.away_club_id, ["FOUL"]),
        homeYellowCards: metric(f.home_club_id, ["YELLOW_CARD"]), awayYellowCards: metric(f.away_club_id, ["YELLOW_CARD"]),
        homeRedCards: metric(f.home_club_id, ["RED_CARD"]), awayRedCards: metric(f.away_club_id, ["RED_CARD"]),
        homeSubstitutions: metric(f.home_club_id, ["SUBSTITUTION"]), awaySubstitutions: metric(f.away_club_id, ["SUBSTITUTION"]),
        homeInjuries: metric(f.home_club_id, ["INJURY"]), awayInjuries: metric(f.away_club_id, ["INJURY"]),
        events: count, minutes: 90
    };
}