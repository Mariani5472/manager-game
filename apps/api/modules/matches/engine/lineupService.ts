import type {
    SqliteDatabase,
} from "../../../db/database.js";
import {
    bestPosition,
    loadPositions,
} from "./playerLoader.js";
import {
    fit,
    skill,
} from "./strengthCalculator.js";
import type {
    MatchPlayer,
    Player,
    Tactic,
} from "../types/match-engine.types.js";


export function selectLineup(
    db: SqliteDatabase,
    fixtureId: number,
    clubId: number,
    players: Player[],
    tactic: Tactic,
    persist = true
): MatchPlayer[] {
    const slots = db.prepare("SELECT slot_number,position_code FROM formation_slot WHERE formation_id=? ORDER BY slot_number").all(tactic.formation_id) as Array<{ slot_number: number; position_code: string }>;
    if (slots.length !== 11) throw new Error(`Formation ${tactic.formation_id} must define exactly 11 slots; found ${slots.length}.`);
    if (players.length < 11) throw new Error(`Club ${clubId} has fewer than eleven available players.`);
    const positions = loadPositions(db, clubId), byId = new Map(players.map(p => [p.id, p]));
    const saved = db.prepare("SELECT player_id AS id,slot_number AS slot,position_code AS role,is_starting AS isStarting FROM match_lineup WHERE fixture_id=? AND club_id=? ORDER BY slot_number").all(fixtureId, clubId) as Array<{ id: number; slot: number; role: string; isStarting: number }>;
    const existing = saved.filter(p => p.isStarting === 1);
    let starters: MatchPlayer[] = [];
    const valid = existing.length === 11 && new Set(existing.map(p => p.id)).size === 11 && existing.every(p => byId.has(p.id)) && existing.filter(p => p.role === "GK" && byId.get(p.id)?.goalkeeper === 1).length === 1 && slots.every(slot => existing.some(p => p.slot === slot.slot_number && p.role === slot.position_code));
    if (valid) {
        starters = existing.map(p => ({ ...byId.get(p.id)!, role: p.role, slot: p.slot, isStarting: true, positionRating: positions.get(p.id)?.get(p.role) ?? 50 }));
    } else {
        if (persist) db.prepare("DELETE FROM match_lineup WHERE fixture_id=? AND club_id=?").run(fixtureId, clubId);
        const used = new Set<number>();
        for (const slot of slots) {
            const options = players.filter(p => !used.has(p.id)).sort((a, b) => {
                const score = (p: Player) => { const rating = positions.get(p.id)?.get(slot.position_code) ?? 50; return (rating * .48 + skill(p, slot.position_code) * .32 + p.energy * .08 + p.morale * .06 + p.sharpness * .06) * fit(bestPosition(p.id, positions), slot.position_code); };
                return score(b) - score(a) || a.id - b.id;
            });
            const p = options[0]!; used.add(p.id); starters.push({ ...p, role: slot.position_code, slot: slot.slot_number, isStarting: true, positionRating: positions.get(p.id)?.get(slot.position_code) ?? 50 });
        }
        if (starters.filter(p => p.role === "GK" && p.goalkeeper === 1).length !== 1) throw new Error("Formation must assign exactly one goalkeeper to its GK slot.");
        if (persist) { const insert = db.prepare("INSERT INTO match_lineup(fixture_id,club_id,player_id,slot_number,is_starting,position_code) VALUES(?,?,?,?,1,?)"); starters.forEach(p => insert.run(fixtureId, clubId, p.id, p.slot, p.role)); }
    }
    const startersIds = new Set(starters.map(p => p.id));
    const savedBench = saved.filter(p => p.isStarting === 0 && byId.has(p.id) && !startersIds.has(p.id)).slice(0, 7);
    const bench: MatchPlayer[] = savedBench.length ? savedBench.map(p => ({ ...byId.get(p.id)!, role: p.role, slot: p.slot, isStarting: false, positionRating: positions.get(p.id)?.get(p.role) ?? 50 })) :
        players.filter(p => !startersIds.has(p.id)).sort((a, b) => (skill(b, bestPosition(b.id, positions)) + b.energy * .3 + b.morale * .2) - (skill(a, bestPosition(a.id, positions)) + a.energy * .3 + a.morale * .2)).slice(0, 7).map((p, i) => ({ ...p, role: bestPosition(p.id, positions), slot: 12 + i, isStarting: false, positionRating: positions.get(p.id)?.get(bestPosition(p.id, positions)) ?? 50 }));
    if (persist) { const insert = db.prepare("INSERT INTO match_lineup(fixture_id,club_id,player_id,slot_number,is_starting,position_code) VALUES(?,?,?,?,0,?)"); for (const p of bench) if (!saved.some(s => s.id === p.id && s.isStarting === 0)) insert.run(fixtureId, clubId, p.id, p.slot, p.role); }
    return [...starters, ...bench];
}