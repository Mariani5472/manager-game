import type { DataPackage } from "../types/data-package.types.js";
import {
    ATTRIBUTES,
    STANDING_RULES,
} from "../types/data-package.constants.js";
import {
    assert,
    code,
    positiveInt,
    textValue,
    unique,
} from "./validation.utils.js";


export function parseDataPackage(
    raw: string
): DataPackage {
    let value: unknown;

    try {
        value = JSON.parse(raw);
    } catch {
        throw new Error(
            "Data package is not valid JSON."
        );
    }


    assert(
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value),
        "Data package root must be a JSON object."
    );


    const pkg = value as DataPackage;


    assert(
        pkg.schemaVersion === 1,
        `Unsupported data package schemaVersion: ` +
        `${String(pkg.schemaVersion)}. Supported: 1.`
    );

    code(pkg.id, "package.id");
    textValue(pkg.version, "package.version");

    assert(
        /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
            pkg.version
        ),
        "package.version must use semantic versioning " +
        "(for example 1.0.0)."
    );


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