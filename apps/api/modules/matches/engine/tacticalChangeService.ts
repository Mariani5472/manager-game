import type { SqliteDatabase } from "../../../../db/database.js";
import { loadTeam } from "./teamService.js";
import type { TacticalChangeType } from "./types.js";

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

    const lineupState = db
      .prepare(
        "SELECT player_id AS playerId,is_starting AS isStarting FROM match_lineup WHERE fixture_id=? AND club_id=? AND player_id IN (?,?)",
      )
      .all(fixtureId, clubId, playerOutId, playerInId) as Array<{
      playerId: number;
      isStarting: number;
    }>;

    if (
      lineupState.length !== 2 ||
      lineupState.find((player) => player.playerId === playerOutId)
        ?.isStarting !== 1 ||
      lineupState.find((player) => player.playerId === playerInId)
        ?.isStarting !== 0
    ) {
      throw new Error(
        "Select a current starter and a saved bench player before scheduling a substitution.",
      );
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
