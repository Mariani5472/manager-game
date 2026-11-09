import { SqliteDatabase } from "../../../db/database.js";


export interface PlayerSummary {
  id: number;
  name: string;
  shirtNumber: number | null;
  squadStatus: string;
  positions: string[];
  energy: number;
  morale: number;
  sharpness: number;
}


interface PlayerSummaryRow {
  id: number;
  name: string;
  shirtNumber: number | null;
  squadStatus: string;
  positionsJson: string;
  energy: number;
  morale: number;
  sharpness: number;
}


export function listSquad(
  db: SqliteDatabase,
  clubId: number
): PlayerSummary[] {
  const rows = db
    .prepare<number, PlayerSummaryRow>(`
      SELECT
        p.id AS id,
        p.full_name AS name,
        sm.shirt_number AS shirtNumber,
        sm.squad_status AS squadStatus,

        COALESCE(
          (
            SELECT json_group_array(pp.position_code)
            FROM player_position pp
            WHERE pp.player_id = p.id
          ),
          '[]'
        ) AS positionsJson,

        COALESCE(pc.energy, 100) AS energy,
        COALESCE(pc.morale, 50) AS morale,
        COALESCE(pc.sharpness, 50) AS sharpness

      FROM squad_membership sm

      JOIN person p
        ON p.id = sm.player_id

      LEFT JOIN player_condition pc
        ON pc.player_id = p.id

      WHERE sm.club_id = ?

      ORDER BY
        CASE sm.squad_status
          WHEN 'FIRST_TEAM' THEN 0
          WHEN 'RESERVE' THEN 1
          ELSE 2
        END,
        sm.shirt_number,
        p.full_name
    `)
    .all(clubId);


  return rows.map(
    ({ positionsJson, ...row }) => ({
      ...row,
      positions: JSON.parse(positionsJson) as string[],
    })
  );
}


export interface TacticSummary {
  formation: string;
  mentality: string;
  pressing: number;
  tempo: number;
  defensiveLine: number;
  width: number;
  passingDirectness: number;
  counterAttack: boolean;
}


type TacticSummaryRow =
  Omit<TacticSummary, "counterAttack"> & {
    counterAttack: number;
  };


export function getTactics(
  db: SqliteDatabase,
  clubId: number
): TacticSummary {
  const row = db
    .prepare<number, TacticSummaryRow>(`
      SELECT
        f.name AS formation,
        tt.mentality,
        tt.pressing,
        tt.tempo,
        tt.defensive_line AS defensiveLine,
        tt.width,
        tt.passing_directness AS passingDirectness,
        tt.counter_attack AS counterAttack

      FROM team_tactic tt

      JOIN formation f
        ON f.id = tt.formation_id

      WHERE tt.club_id = ?
    `)
    .get(clubId);


  if (!row) {
    throw new Error(
      `Tactics for club ${clubId} were not found.`
    );
  }


  return {
    ...row,
    counterAttack: row.counterAttack === 1,
  };
}