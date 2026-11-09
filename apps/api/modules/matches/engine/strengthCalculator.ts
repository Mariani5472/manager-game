import {
  COMPATIBLE_POSITIONS,
} from "./constants.js";
import { mean } from "./mathUtils.js";
import type {
  Player,
  Team,
} from "./types.js";


export function fit(
  actual: string,
  required: string
): number {
  if (actual === required) {
    return 1;
  }

  return COMPATIBLE_POSITIONS[required]
    ?.includes(actual)
    ? 0.82
    : 0.48;
}


export function skill(
  player: Player,
  role: string
): number {
  if (role === "GK") {
    return mean([
      player.reflexes,
      player.handling,
      player.positioning,
      player.concentration,
      player.aerial_reach,
    ]);
  }

  if (
    ["CB", "LB", "RB", "LWB", "RWB"].includes(role)
  ) {
    return mean([
      player.tackling,
      player.marking,
      player.positioning,
      player.strength,
      player.pace,
    ]);
  }

  if (
    ["DM", "CM", "AM"].includes(role)
  ) {
    return mean([
      player.passing,
      player.vision,
      player.decisions,
      player.teamwork,
      player.stamina,
    ]);
  }

  if (
    ["LW", "RW", "LM", "RM"].includes(role)
  ) {
    return mean([
      player.pace,
      player.dribbling,
      player.crossing,
      player.composure,
    ]);
  }

  return mean([
    player.finishing,
    player.composure,
    player.positioning,
    player.heading,
    player.decisions,
  ]);
}


export function refreshTeamStrength(
  team: Team
): void {
  const starters = team.lineup.filter(
    player => player.isStarting
  );

  team.attacking =
    mean(
      starters.map(
        player =>
          skill(player, player.role) * 0.72 +
          player.positionRating * 0.28 +
          player.energy * 0.18 +
          player.morale * 0.08 +
          player.sharpness * 0.08
      )
    ) +
    (
      mean(
        starters.map(
          player => player.positionRating
        )
      ) - 50
    ) * 0.15;

  team.defending = mean(
    starters.map(
      player =>
        mean([
          player.tackling,
          player.marking,
          player.positioning,
          player.concentration,
          player.strength,
        ])
    )
  );

  const keeper = starters.find(
    player => player.role === "GK"
  );

  team.goalkeeping = keeper
    ? mean([
        keeper.reflexes,
        keeper.handling,
        keeper.aerial_reach,
        keeper.positioning,
      ])
    : 45;

  team.energy = mean(
    starters.map(player => player.energy)
  );

  team.fitness = mean(
    starters.map(player => player.stamina)
  );
}


export function calculateTeamStrength(
  team: Team
): number {
  return (
    team.attacking * 0.4 +
    team.defending * 0.35 +
    team.goalkeeping * 0.25
  );
}