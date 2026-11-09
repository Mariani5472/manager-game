import type { SqliteDatabase } from "../../../db/database.js";
import { loadTeam } from "./teamService.js";
import type { TacticalChangeType } from "../types/match-engine.types.js";

interface ProjectedLineupPlayer {
  playerId: number;
  slot: number;
  role: string;
  isStarting: boolean;
  goalkeeper: number;
}

function getProjectedLineup(
  db: SqliteDatabase,
  fixtureId: number,
  clubId: number,
  throughMinute: number,
): Map<number, ProjectedLineupPlayer> {
  const players = db.prepare(
    `SELECT ml.player_id AS playerId,ml.slot_number AS slot,
      ml.position_code AS role,ml.is_starting AS isStarting,p.goalkeeper
     FROM match_lineup ml
     JOIN player p ON p.person_id=ml.player_id
     WHERE ml.fixture_id=? AND ml.club_id=?`,
  ).all(fixtureId, clubId) as Array<{
    playerId:number; slot:number; role:string; isStarting:number; goalkeeper:number;
  }>;
  const projected = new Map(players.map(player => [player.playerId, {
    playerId:player.playerId,
    slot:player.slot,
    role:player.role,
    isStarting:player.isStarting === 1,
    goalkeeper:player.goalkeeper,
  }]));

  const changes = db.prepare(
    `SELECT change_type AS changeType,payload
     FROM match_tactical_change
     WHERE fixture_id=? AND club_id=? AND minute<=?
     ORDER BY minute,id`,
  ).all(fixtureId, clubId, throughMinute) as Array<{changeType:string;payload:string}>;

  for (const change of changes) {
    const payload = JSON.parse(change.payload) as Record<string, unknown>;
    if (change.changeType === "SUBSTITUTION") {
      const outgoing = projected.get(Number(payload.playerOutId));
      const incoming = projected.get(Number(payload.playerInId));
      if (!outgoing || !incoming || !outgoing.isStarting || incoming.isStarting) {
        throw new Error("A previously scheduled substitution has an invalid projected lineup.");
      }
      incoming.slot = outgoing.slot;
      incoming.role = outgoing.role;
      incoming.isStarting = true;
      outgoing.isStarting = false;
    }

    if (change.changeType === "FORMATION" && Array.isArray(payload.slots)) {
      for (const player of projected.values()) player.isStarting = false;
      for (const raw of payload.slots as Array<{playerId:number;slotNumber:number;positionCode:string}>) {
        const player = projected.get(Number(raw.playerId));
        if (!player) throw new Error("A previously scheduled formation references a player outside the lineup.");
        player.slot = Number(raw.slotNumber);
        player.role = String(raw.positionCode);
        player.isStarting = true;
      }
    }
  }

  return projected;
}

export function scheduleMatchTacticalChange(
  db: SqliteDatabase,
  fixtureId: number,
  clubId: number,
  minute: number,
  changeType: TacticalChangeType,
  payload: Record<string, unknown>,
): number {
  if (!Number.isSafeInteger(minute) || minute < 1 || minute > 90) {
    throw new Error("Tactical change minute must be between 1 and 90.");
  }

  const fixture = db
    .prepare(
      "SELECT status,current_minute AS currentMinute,home_club_id AS home,away_club_id AS away,scheduled_at AS scheduledAt FROM fixture WHERE id=?",
    )
    .get(fixtureId) as
    | {
        status: string;
        currentMinute: number;
        home: number;
        away: number;
        scheduledAt: string | null;
      }
    | undefined;

  if (!fixture) throw new Error("Fixture not found.");
  if (!["SCHEDULED", "IN_PROGRESS"].includes(fixture.status)) {
    throw new Error("Tactical changes require a scheduled or in-progress fixture.");
  }
  if (clubId !== fixture.home && clubId !== fixture.away) {
    throw new Error("Club is not part of this fixture.");
  }
  if (fixture.status === "IN_PROGRESS" && minute <= fixture.currentMinute) {
    throw new Error("Cannot schedule a change at or before the current minute.");
  }

  if (
    changeType === "MENTALITY" &&
    ![
      "VERY_DEFENSIVE",
      "DEFENSIVE",
      "BALANCED",
      "ATTACKING",
      "VERY_ATTACKING",
    ].includes(String(payload.mentality ?? ""))
  ) {
    throw new Error("Invalid mentality.");
  }

  if (changeType === "INSTRUCTION") {
    const key = String(payload.key ?? "");
    const value = Number(payload.value);
    const ranges: Record<string, [number, number]> = {
      pressing: [0, 100],
      tempo: [0, 100],
      defensive_line: [0, 100],
      width: [0, 100],
      passing_directness: [0, 100],
      counter_attack: [0, 1],
    };

    if (
      !ranges[key] ||
      !Number.isFinite(value) ||
      value < ranges[key]![0] ||
      value > ranges[key]![1]
    ) {
      throw new Error("Invalid instruction key or value.");
    }
  }

  if (changeType === "FORMATION") {
    loadTeam(db, fixtureId, clubId);
    const formationId = Number(payload.formationId);

    if (!Number.isSafeInteger(formationId) || formationId <= 0 ||
        !db.prepare("SELECT 1 FROM formation WHERE id=?").get(formationId)) {
      throw new Error("Formation does not exist.");
    }

    const slots = db.prepare(
      "SELECT slot_number AS slotNumber,position_code AS positionCode FROM formation_slot WHERE formation_id=? ORDER BY slot_number",
    ).all(formationId) as Array<{slotNumber:number;positionCode:string}>;
    const projected = getProjectedLineup(db, fixtureId, clubId, minute);
    const starters = [...projected.values()]
      .filter(player => player.isStarting)
      .sort((left,right) => left.slot-right.slot);

    if (
      slots.length !== 11 ||
      starters.length !== 11 ||
      slots.filter(slot => slot.positionCode === "GK").length !== 1
    ) {
      throw new Error("Formation changes require eleven projected starters and exactly one goalkeeper slot.");
    }

    const keepers = starters.filter(player => player.goalkeeper === 1);
    if (keepers.length !== 1) throw new Error("Current projected lineup must contain exactly one goalkeeper.");
    const keeper = keepers[0]!;
    const outfield = starters.filter(player => player.goalkeeper !== 1);
    let outfieldIndex = 0;
    payload = {
      formationId,
      slots: slots.map(slot => ({
        slotNumber:slot.slotNumber,
        positionCode:slot.positionCode,
        playerId:slot.positionCode === "GK" ? keeper.playerId : outfield[outfieldIndex++]!.playerId,
      })),
    };
  }

  if (changeType === "SUBSTITUTION") {
    loadTeam(db, fixtureId, clubId);
    const playerOutId = Number(payload.playerOutId);
    const playerInId = Number(payload.playerInId);

    if (
      !Number.isSafeInteger(playerOutId) ||
      !Number.isSafeInteger(playerInId) ||
      playerOutId === playerInId
    ) {
      throw new Error(
        "Substitution requires different playerOutId and playerInId.",
      );
    }

    const outgoing = db
      .prepare(
        "SELECT p.goalkeeper AS goalkeeper FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id WHERE sm.player_id=? AND sm.club_id=?",
      )
      .get(playerOutId, clubId) as { goalkeeper: number } | undefined;
    const incoming = db
      .prepare(
        "SELECT p.goalkeeper AS goalkeeper,COALESCE(pc.suspension_matches,0) AS suspension,pc.injured_until AS injuredUntil FROM squad_membership sm JOIN player p ON p.person_id=sm.player_id LEFT JOIN player_condition pc ON pc.player_id=p.person_id WHERE sm.player_id=? AND sm.club_id=?",
      )
      .get(playerInId, clubId) as
      | {
          goalkeeper: number;
          suspension: number;
          injuredUntil: string | null;
        }
      | undefined;

    if (!outgoing || !incoming) {
      throw new Error("Both players must belong to the selected club.");
    }

    // Validate against the projected lineup at the requested minute, not
    // only the original XI. Earlier scheduled substitutions may change who is
    // active or on the bench by the time this decision is applied.
    const projectedLineup = getProjectedLineup(db, fixtureId, clubId, minute);
    const projectedActive = new Set([...projectedLineup.entries()].filter(([, player]) => player.isStarting).map(([id]) => id));
    if (!projectedActive.has(playerOutId) || projectedActive.has(playerInId)) {
      throw new Error("Select a player projected to be active and another projected to be on the bench at the decision minute.");
    }

    const matchDate = fixture.scheduledAt?.slice(0, 10) ?? null;
    if (
      incoming.suspension > 0 ||
      (incoming.injuredUntil &&
        matchDate &&
        incoming.injuredUntil >= matchDate)
    ) {
      throw new Error("Incoming player is unavailable.");
    }

    if (outgoing.goalkeeper !== incoming.goalkeeper) {
      throw new Error("A goalkeeper can only be replaced by another goalkeeper, and outfield players must replace outfield players.");
    }

    payload = { playerOutId, playerInId };
  }

  return Number(
    db
      .prepare(
        "INSERT INTO match_tactical_change(fixture_id,minute,club_id,change_type,payload) VALUES(?,?,?,?,?)",
      )
      .run(
        fixtureId,
        minute,
        clubId,
        changeType,
        JSON.stringify(payload),
      ).lastInsertRowid,
  );
}
