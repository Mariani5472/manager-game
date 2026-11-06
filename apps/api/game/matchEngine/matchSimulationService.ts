import type {
    SqliteDatabase,
} from "../../db/database.js";
import {
    persistMatchEnvironment,
    recoverSquadBeforeMatch,
    resolveMatchContext,
} from "../matchContext.js";
import {
    loadTeam,
} from "./teamService.js";
import {
    simulateMatchTimeline,
} from "./timelineSimulator.js";
import type {
    FixtureRow,
    KernelMinute,
    MatchSummary,
    TacticalChange,
} from "./types.js";


export function simulateMatch(
    db: SqliteDatabase,
    fixtureId: number
): MatchSummary {
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
    const timeline = simulateMatchTimeline(home, away, seed, changes);
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
        if (checkpoint.config !== undefined && JSON.stringify(checkpoint.config) !== JSON.stringify(simulationConfig)) {
            throw new Error(`Fixture ${fixtureId} simulation inputs changed after its checkpoint; refusing a non-deterministic resume.`);
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
            db.prepare("INSERT INTO match_simulation_state(fixture_id,state_version,simulation_minute,state_json) VALUES(?,1,0,?)")
                .run(fixtureId, JSON.stringify({ engineVersion: "1.0.0", seed, config: simulationConfig, minute: 0, homeScore: 0, awayScore: 0, completed: false }));
            const claimed = db.prepare("UPDATE fixture SET status='IN_PROGRESS',random_seed=?,current_minute=0,home_score=0,away_score=0 WHERE id=? AND status='SCHEDULED'").run(seed, fixtureId);
            if (claimed.changes !== 1) throw new Error(`Fixture ${fixtureId} could not be claimed for simulation.`);
        });
        begin.immediate();
    }
    const insertEvent = db.prepare("INSERT INTO match_event(fixture_id,minute,club_id,player_id,secondary_player_id,event_type,xg,description) VALUES(?,?,?,?,?,?,?,?)");
    const insertMomentum = db.prepare("INSERT INTO match_momentum(fixture_id,minute,home_pressure,away_pressure,home_score,away_score) VALUES(?,?,?,?,?,?)");
    const checkpoint = db.prepare("UPDATE match_simulation_state SET simulation_minute=?,state_json=?,updated_at=CURRENT_TIMESTAMP WHERE fixture_id=?");
    const minuteUpdate = db.transaction((m: KernelMinute) => {
        for (const e of m.events) insertEvent.run(fixtureId, e.minute, e.clubId, e.playerId || null, e.secondaryPlayerId, e.eventType, e.xg, e.description);
        insertMomentum.run(fixtureId, m.minute, m.homePressure, m.awayPressure, m.homeScore, m.awayScore);
        checkpoint.run(m.minute, JSON.stringify({
            engineVersion: "1.0.0", seed, config: simulationConfig, minute: m.minute, homeScore: m.homeScore, awayScore: m.awayScore,
            homeShots: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.home_club_id && ["GOAL", "SAVE", "MISS"].includes(e.eventType)).length,
            awayShots: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.away_club_id && ["GOAL", "SAVE", "MISS"].includes(e.eventType)).length,
            homeShotsOnTarget: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.home_club_id && (e.eventType === "GOAL" || e.eventType === "SAVE")).length,
            awayShotsOnTarget: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.away_club_id && (e.eventType === "GOAL" || e.eventType === "SAVE")).length,
            homePressure: m.homePressure, awayPressure: m.awayPressure,
            homeXg: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.home_club_id && ["GOAL", "SAVE", "MISS"].includes(e.eventType)).reduce((n, e) => n + e.xg, 0),
            awayXg: timeline.events.filter(e => e.minute <= m.minute && e.clubId === f.away_club_id && ["GOAL", "SAVE", "MISS"].includes(e.eventType)).reduce((n, e) => n + e.xg, 0),
            completed: false
        }), fixtureId);
        db.prepare("UPDATE fixture SET status='IN_PROGRESS',current_minute=?,home_score=?,away_score=? WHERE id=?")
            .run(m.minute, m.homeScore, m.awayScore, fixtureId);
    });
    for (const m of timeline.minutes) if (m.minute > startMinute) minuteUpdate.immediate(m);
    const finalise = db.transaction(() => {
        const alreadyFullTime = db.prepare("SELECT 1 FROM match_event WHERE fixture_id=? AND event_type='FULL_TIME'").get(fixtureId);
        if (!alreadyFullTime) insertEvent.run(fixtureId, 90, null, null, null, "FULL_TIME", 0, "Fim de jogo");
        db.prepare("DELETE FROM match_player_state WHERE fixture_id=?").run(fixtureId);
        db.prepare("UPDATE match_tactical_change SET applied=1 WHERE fixture_id=?").run(fixtureId);
        const state = db.prepare("INSERT INTO match_player_state(fixture_id,player_id,club_id,energy,rating,minutes_played) VALUES(?,?,?,?,?,?)");
        for (const team of [home, away]) for (const p of team.lineup) {
            const substitutionOut = timeline.events.find(e => e.eventType === "SUBSTITUTION" && e.playerId === p.id);
            const substitutionIn = timeline.events.find(e => e.eventType === "SUBSTITUTION" && e.secondaryPlayerId === p.id);
            const injury = timeline.events.find(e => e.eventType === "INJURY" && e.playerId === p.id);
            const redCard = timeline.events.find(e => e.eventType === "RED_CARD" && e.playerId === p.id);
            const wasStarter = initiallyStartingPlayerIds.has(p.id);
            const exitEvent = substitutionOut ?? injury ?? redCard;
            const loss = wasStarter ? (exitEvent ? 9 : 14) : (substitutionIn ? 7 : 2);
            const minutesPlayed = wasStarter ? (exitEvent ? exitEvent.minute : 90) : (substitutionIn ? Math.max(0, (exitEvent && exitEvent.minute > substitutionIn.minute ? exitEvent.minute : 90) - substitutionIn.minute) : 0);
            state.run(fixtureId, p.id, team.clubId, Math.max(0, p.energy - loss), p.isStarting ? 6.3 : 6, minutesPlayed);
            db.prepare("UPDATE player_condition SET energy=MAX(0,energy-?) WHERE player_id=?").run(loss, p.id);
            if (p.isStarting) {
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
        db.prepare("UPDATE fixture SET status='COMPLETED',current_minute=90,home_score=?,away_score=? WHERE id=?")
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