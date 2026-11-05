import type { Command } from "commander";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { open, validate } from "../../db/database.js";

import {
  ensureFactoryWorld16,
  ensureFactoryLeagueCalendar,
} from "../../game/gameService.js";

import { masterPath, schemaPath } from "../config.js";

export function registerMasterCommands(program: Command): void {
  program
    .command("init-master")
    .description("Inicializa ou atualiza o banco master")
    .action(initializeMaster);

  program
    .command("clubs")
    .description("Lista os clubes disponíveis")
    .action(listMasterClubs);
}

function initializeMaster(): void {
  if (existsSync(masterPath)) {
    const db = open(masterPath);

    try {
      validate(db);

      const world = ensureFactoryWorld16(db);
      const repair = ensureFactoryLeagueCalendar(db);

      validate(db);

      if (world.upgraded) {
        console.log(
          `Factory world upgraded: ${world.clubs} clubs, ${world.leagueFixtures} league fixtures, ${world.cupEntrants} cup entrants.`,
        );
      }

      if (repair.repaired) {
        console.log(
          `Factory league calendar repaired: ${repair.rounds} rounds, ${repair.fixtures} fixtures.`,
        );
      }

      if (!world.upgraded && !repair.repaired) {
        console.log(`Master DB already exists and is valid: ${masterPath}`);
      }
    } finally {
      db.close();
    }

    return;
  }

  mkdirSync(dirname(masterPath), { recursive: true });

  const db = open(masterPath);

  try {
    db.exec(readFileSync(schemaPath, "utf8"));

    validate(db);

    const world = ensureFactoryWorld16(db);
    const repair = ensureFactoryLeagueCalendar(db);

    validate(db);

    if (world.upgraded) {
      console.log(
        `Factory world upgraded: ${world.clubs} clubs, ${world.leagueFixtures} league fixtures, ${world.cupEntrants} cup entrants.`,
      );
    }

    if (repair.repaired) {
      console.log(
        `Factory league calendar repaired: ${repair.rounds} rounds, ${repair.fixtures} fixtures.`,
      );
    }

    console.log(`Master DB created: ${masterPath}`);
  } finally {
    db.close();
  }
}

function listMasterClubs(): void {
  if (!existsSync(masterPath)) {
    throw new Error('Run "npm run dev -- init-master" first.');
  }

  const db = open(masterPath, true);

  try {
    validate(db);

  } finally {
    db.close();
  }
}