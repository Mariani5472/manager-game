import type {
    SqliteDatabase,
} from "../../db/database.js";
import type {
    MatchContext,
} from "../matchContext.js";
import {
    runMonteCarlo,
} from "./monteCarloService.js";
import {
    refreshTeamStrength,
} from "./strengthCalculator.js";
import {
    loadTeam,
} from "./teamService.js";
import type {
    MatchPlayer,
    Tactic,
    TacticalSensitivityReport,
    Team,
} from "./types.js";


function cloneTeam(
    team: Team
): Team {
    return {
        ...team,

        tactic: {
            ...team.tactic,
        },

        lineup: team.lineup.map(
            player => ({
                ...player,
            })
        ),

        ...(
            team.context
                ? {
                    context: {
                        ...team.context,
                    },
                }
                : {}
        ),
    };
}


/**
 * One-variable-at-a-time sensitivity analysis using common seeds for comparison.
 */
export function runTacticalSensitivityAnalysis(
    db: SqliteDatabase,
    homeClubId: number,
    awayClubId: number,
    simulations = 1000,
    seed = 73421
): TacticalSensitivityReport {
    if (homeClubId === awayClubId) throw new Error("Sensitivity analysis requires two different clubs.");
    if (!Number.isSafeInteger(simulations) || simulations < 100) throw new Error("Sensitivity simulations must be an integer >= 100.");
    const originalHome = loadTeam(db, -1, homeClubId, false), originalAway = loadTeam(db, -1, awayClubId, false);
    const baseline = runMonteCarlo(originalHome, originalAway, simulations, seed);
    const clone = (team: Team): Team => ({ ...team, tactic: { ...team.tactic }, lineup: team.lineup.map(player => ({ ...player })), ...(team.context ? { context: { ...team.context } } : {}) });
    const scenarios: Array<{ name: string; changedVariable: string; value: string | number; home: Team }> = [];
    const tacticCase = (name: string, key: keyof Tactic, value: number | string) => {
        const home = clone(originalHome); home.tactic = { ...home.tactic, [key]: value } as Tactic; scenarios.push({ name, changedVariable: String(key), value, home });
    };
    tacticCase("pressing_low", "pressing", 20); tacticCase("pressing_high", "pressing", 80);
    tacticCase("tempo_low", "tempo", 20); tacticCase("tempo_high", "tempo", 80);
    tacticCase("defensive_line_low", "defensive_line", 20); tacticCase("defensive_line_high", "defensive_line", 80);
    tacticCase("width_low", "width", 20); tacticCase("width_high", "width", 80);
    tacticCase("passing_directness_low", "passing_directness", 20); tacticCase("passing_directness_high", "passing_directness", 80);
    tacticCase("counter_attack_off", "counter_attack", 0); tacticCase("counter_attack_on", "counter_attack", 1);
    tacticCase("mentality_defensive", "mentality", "DEFENSIVE"); tacticCase("mentality_very_attacking", "mentality", "VERY_ATTACKING");
    for (const attribute of ["energy", "morale", "sharpness"] as const) for (const value of [20, 80]) {
        const home = clone(originalHome);
        home.lineup = home.lineup.map(player => player.isStarting ? { ...player, [attribute]: value } : player);
        refreshTeamStrength(home);
        scenarios.push({ name: attribute + "_" + value, changedVariable: attribute, value, home });
    }
    for (const [name, contextPatch, value] of [
        ["weather_clear", { weather: "CLEAR" }, "CLEAR"],
        ["weather_heavy_rain", { weather: "HEAVY_RAIN" }, "HEAVY_RAIN"],
        ["pitch_poor", { pitchCondition: 35 }, 35],
        ["pitch_good", { pitchCondition: 90 }, 90],
        ["rest_short", { restHours: 24 }, 24],
        ["rest_full", { restHours: 168 }, 168],
        ["travel_none", { travelKm: 0 }, 0],
        ["travel_long", { travelKm: 1200 }, 1200],
    ] as Array<[string, Partial<MatchContext>, string | number]>) {
        const home = clone(originalHome);
        home.context = { ...(home.context ?? { weather: "CLEAR", temperatureC: 20, pitchCondition: 70, restHours: 168, travelKm: 0, travelHours: 0 }), ...contextPatch } as MatchContext;
        scenarios.push({ name, changedVariable: name.split("_")[0]!, value, home });
    }
    const keeperCase = clone(originalHome);
    const keeper = keeperCase.lineup.find(player => player.isStarting && player.role === "GK");
    if (keeper) {
        keeper.reflexes = 95; keeper.handling = 95; keeper.positioning = 95; keeper.concentration = 95; refreshTeamStrength(keeperCase);
        scenarios.push({ name: "exceptional_goalkeeper", changedVariable: "goalkeeper attributes", value: 95, home: keeperCase });
    }
    for (const value of [20, 95]) {
        const finishingCase = clone(originalHome);
        const shooter = finishingCase.lineup.find(player => player.isStarting && player.role === "ST") ??
            finishingCase.lineup.find(player => player.isStarting && player.role !== "GK");
        if (shooter) {
            shooter.finishing = value;
            scenarios.push({ name: "individual_finishing_" + value, changedVariable: "individual finishing", value, home: finishingCase });
        }
    }
    for (const value of [20, 90]) {
        const defendingCase = clone(originalHome);
        const defender = defendingCase.lineup.find(player => player.isStarting && ["CB", "LB", "RB", "DM"].includes(player.role));
        if (defender) {
            defender.tackling = value; defender.marking = value; defender.positioning = value;
            refreshTeamStrength(defendingCase);
            scenarios.push({ name: "individual_defending_" + value, changedVariable: "individual defensive attributes", value, home: defendingCase });
        }
    }
    const roleCase = clone(originalHome);
    const striker = roleCase.lineup.find(player => player.isStarting && player.role === "ST");
    if (striker) {
        striker.role = "CM"; refreshTeamStrength(roleCase);
        scenarios.push({ name: "striker_role_changed_to_cm", changedVariable: "player role", value: "ST->CM", home: roleCase });
    }
    const alternateFormation = db.prepare("SELECT id FROM formation WHERE id<>? ORDER BY id LIMIT 1").get(originalHome.tactic.formation_id) as { id: number } | undefined;
    const formationCase = clone(originalHome);
    const starters = formationCase.lineup.filter(player => player.isStarting);
    const formationKeeper = starters.find(player => player.role === "GK");
    const outfield = starters.filter(player => player.role !== "GK");
    const alternateSlots = alternateFormation
        ? db.prepare("SELECT slot_number AS slot,position_code AS role FROM formation_slot WHERE formation_id=? ORDER BY slot_number").all(alternateFormation.id) as Array<{ slot: number; role: string }>
        : [];
    const slots = alternateSlots.length === 11 && alternateSlots.some(slot => slot.role === "GK")
        ? alternateSlots
        : ["GK", "CB", "CB", "LB", "RB", "DM", "CM", "CM", "LW", "RW", "ST"].map((role, index) => ({ slot: index + 1, role }));
    const assigned: Array<{ slot: number; role: string; player: MatchPlayer }> = [];
    let outfieldIndex = 0;
    for (const slot of slots) {
        const player = slot.role === "GK" ? formationKeeper : outfield[outfieldIndex++];
        if (!player) continue;
        assigned.push({ slot: slot.slot, role: slot.role, player });
    }
    if (assigned.length === 11 && assigned.filter(item => item.role === "GK" && item.player.goalkeeper === 1).length === 1) {
        for (const item of assigned) { item.player.slot = item.slot; item.player.role = item.role; }
        formationCase.tactic = { ...formationCase.tactic, formation_id: alternateSlots.length === 11 && alternateSlots.some(slot => slot.role === "GK") ? alternateFormation!.id : originalHome.tactic.formation_id + 1 };
        refreshTeamStrength(formationCase);
        scenarios.push({ name: "alternate_formation", changedVariable: "formation", value: alternateFormation?.id ?? "synthetic-role-layout", home: formationCase });
    }

    const rows = scenarios.map(s => {
        const result = runMonteCarlo(s.home, originalAway, simulations, seed);
        return {
            name: s.name, changedVariable: s.changedVariable, value: s.value,
            homeWinRate: result.homeWinRate, homeWinRateDelta: result.homeWinRate - baseline.homeWinRate,
            averageHomeGoals: result.averageHomeGoals, averageHomeGoalsDelta: result.averageHomeGoals - baseline.averageHomeGoals,
            homeShotsPerMatch: result.homeShotRate, homeShotsDelta: result.homeShotRate - baseline.homeShotRate,
            averageTotalXg: result.averageTotalXg, averageTotalXgDelta: result.averageTotalXg - baseline.averageTotalXg
        };
    });
    return { homeClubId, awayClubId, simulations, seed, baseline, scenarios: rows };
}