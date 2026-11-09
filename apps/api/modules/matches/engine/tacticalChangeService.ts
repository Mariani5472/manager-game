import type { SqliteDatabase } from "../../../db/database.js";
import { loadTeam } from "./teamService.js";
import type { TacticalChangeType } from "../types/match-engine.types.js";

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

    if (!db.prepare("SELECT 1 FROM formation WHERE id=?").get(formationId)) {
      throw new Error("Formation does not exist.");
    }

    const slots = db
      .prepare(
        "SELECT slot_number AS slotNumber,position_code AS positionCode FROM formation_slot WHERE formation_id=? ORDER BY slot_number",
      )
      .all(formationId) as Array<{
      slotNumber: number;
      positionCode: string;
    }>;
    const starters = db
      .prepare(
        "SELECT ml.player_id AS playerId,p.goalkeeper AS goalkeeper FROM match_lineup ml JOIN player p ON p.person_id=ml.player_id WHERE ml.fixture_id=? AND ml.club_id=? AND ml.is_starting=1 ORDER BY ml.slot_number",
      )
      .all(fixtureId, clubId) as Array<{
      playerId: number;
      goalkeeper: number;
    }>;

    if (
      slots.length !== 11 ||
      starters.length !== 11 ||
      slots.filter((slot) => slot.positionCode === "GK").length !== 1
    ) {
      throw new Error(
        "Formation changes require eleven starters and exactly one goalkeeper slot.",
      );
    }

    const keeper = starters.find((player) => player.goalkeeper === 1);
    if (!keeper) throw new Error("Current lineup has no goalkeeper.");

    const outfield = starters.filter((player) => player.goalkeeper !== 1);
    let outfieldIndex = 0;
    payload = {
      formationId,
      slots: slots.map((slot) => ({
        slotNumber: slot.slotNumber,
        positionCode: slot.positionCode,
        playerId:
          slot.positionCode === "GK"
            ? keeper.playerId
            : outfield[outfieldIndex++]!.playerId,
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
    const pendingChanges = db.prepare(
      "SELECT id,minute,club_id,change_type,payload FROM match_tactical_change WHERE fixture_id=? AND club_id=? AND minute<? ORDER BY minute,id",
    ).all(fixtureId, clubId, minute) as Array<{ id:number; minute:number; club_id:number; change_type:string; payload:string }>;
    const projectedLineup = new Map((db.prepare(
      "SELECT player_id AS playerId,slot_number AS slot,position_code AS role,is_starting AS isStarting FROM match_lineup WHERE fixture_id=? AND club_id=?",
    ).all(fixtureId, clubId) as Array<{ playerId:number; slot:number; role:string; isStarting:number }>).map(player =>
      [player.playerId, { slot:player.slot, role:player.role, isStarting:player.isStarting === 1 }]
    ));
    for (const change of pendingChanges) {
      const changePayload = JSON.parse(change.payload) as Record<string, unknown>;
      if (change.change_type === "SUBSTITUTION") {
        const outgoing = projectedLineup.get(Number(changePayload.playerOutId));
        const incoming = projectedLineup.get(Number(changePayload.playerInId));
        if (outgoing && incoming) {
          incoming.slot = outgoing.slot;
          incoming.role = outgoing.role;
          incoming.isStarting = true;
          outgoing.isStarting = false;
        }
      }
      if (change.change_type === "FORMATION" && Array.isArray(changePayload.slots)) {
        for (const player of projectedLineup.values()) player.isStarting = false;
        for (const rawSlot of changePayload.slots as Array<{ playerId:number; slotNumber:number; positionCode:string }>) {
          const player = projectedLineup.get(Number(rawSlot.playerId));
          if (player) {
            player.slot = Number(rawSlot.slotNumber);
            player.role = String(rawSlot.positionCode);
            player.isStarting = true;
          }
        }
      }
    }
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

    if (outgoing.goalkeeper === 1 && incoming.goalkeeper !== 1) {
      throw new Error("A goalkeeper can only be replaced by another goalkeeper.");
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
