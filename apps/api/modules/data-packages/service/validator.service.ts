import type { SqliteDatabase } from "../../../db/database.js";
import { CURRENT_GAME_VERSION } from "../types/data-package.constants.js";
import {
  lookupEntity,
  packageInstalledVersion,
} from "../repo/entity.repository.js";
import { ensureDataPackageSchema } from "../repo/data-package-schema.repository.js";
import type { DataPackage, EntityType } from "../types/data-package.types.js";
import { compareVersions } from "./validation.utils.js";

export function validateDataPackage(
  db: SqliteDatabase,
  pkg: DataPackage,
): string[] {
  ensureDataPackageSchema(db);

  const errors: string[] = [];

  if (
    compareVersions(
      CURRENT_GAME_VERSION,
      pkg.minGameVersion ?? CURRENT_GAME_VERSION,
    ) < 0
  ) {
    errors.push(
      `Package requires game version ${pkg.minGameVersion}; ` +
        `current version is ${CURRENT_GAME_VERSION}.`,
    );
  }

  for (const dependency of pkg.dependencies ?? []) {
    const installed = packageInstalledVersion(db, dependency.id);

    if (!installed) {
      errors.push(`Missing dependency: ${dependency.id}.`);
    } else if (dependency.version && installed !== dependency.version) {
      errors.push(
        `Dependency ${dependency.id} requires ` +
          `${dependency.version}, installed version is ` +
          `${installed}.`,
      );
    }
  }

  const checkRef = (
    type: EntityType,
    externalId: string,
    local: Set<string>,
  ) => {
    if (!local.has(externalId) && !lookupEntity(db, type, externalId)) {
      errors.push(`Unresolved reference ${type} "${externalId}".`);
    }
  };

  const nations = new Set((pkg.nations ?? []).map((x) => x.code));
  const cities = new Set((pkg.cities ?? []).map((x) => x.code));
  const clubs = new Set((pkg.clubs ?? []).map((x) => x.code));
  const stadiums = new Set((pkg.stadiums ?? []).map((x) => x.code));
  const competitions = new Set((pkg.competitions ?? []).map((x) => x.code));
  for (const city of pkg.cities ?? [])
    if (!nations.has(city.nationCode))
      checkRef("nation", city.nationCode, nations);
  for (const club of pkg.clubs ?? []) {
    if (!nations.has(club.nationCode))
      checkRef("nation", club.nationCode, nations);
    if (club.cityCode && !cities.has(club.cityCode))
      checkRef("city", club.cityCode, cities);
  }
  for (const stadium of pkg.stadiums ?? []) {
    if (stadium.clubCode && !clubs.has(stadium.clubCode))
      checkRef("club", stadium.clubCode, clubs);
    if (stadium.cityCode && !cities.has(stadium.cityCode))
      checkRef("city", stadium.cityCode, cities);
  }
  for (const player of pkg.players ?? []) {
    if (player.nationalityCode && !nations.has(player.nationalityCode))
      checkRef("nation", player.nationalityCode, nations);
    if (player.clubCode && !clubs.has(player.clubCode))
      checkRef("club", player.clubCode, clubs);
  }
  for (const competition of pkg.competitions ?? []) {
    if (competition.nationCode && !nations.has(competition.nationCode))
      checkRef("nation", competition.nationCode, nations);
    for (const season of competition.seasons)
      for (const stage of season.stages) {
        for (const participant of stage.participants)
          if (!clubs.has(participant.clubCode))
            checkRef("club", participant.clubCode, clubs);
        for (const movement of stage.promotionRelegation ?? [])
          if (
            movement.targetCompetitionCode &&
            !competitions.has(movement.targetCompetitionCode)
          )
            checkRef(
              "competition",
              movement.targetCompetitionCode,
              competitions,
            );
        const groupCodes = new Set(
          (stage.groups ?? []).map((group) => group.code),
        );
        if (
          stage.participants.some(
            (p) => p.groupCode && !groupCodes.has(p.groupCode),
          )
        )
          errors.push(`Stage ${stage.code} references an undefined group.`);
        if (
          (stage.format?.groupCount ?? 1) > 1 &&
          (stage.groups?.length ?? 0) < (stage.format?.groupCount ?? 1)
        )
          errors.push(
            `Stage ${stage.code} has fewer groups than format.groupCount.`,
          );
        if (stage.calendar) {
          const participantCodes = new Set(
            stage.participants.map((p) => p.clubCode),
          );
          const seenRounds = new Set<number>();
          for (const round of stage.calendar) {
            if (seenRounds.has(round.number))
              errors.push(
                `Stage ${stage.code} has duplicate round number ${round.number}.`,
              );
            seenRounds.add(round.number);
            for (const fixture of round.fixtures) {
              if (fixture.homeClubCode === fixture.awayClubCode)
                errors.push(
                  `Stage ${stage.code} has a fixture where a club plays itself.`,
                );
              for (const clubCode of [
                fixture.homeClubCode,
                fixture.awayClubCode,
              ])
                if (!participantCodes.has(clubCode))
                  errors.push(
                    `Fixture in ${stage.code} references non-participant club ${clubCode}.`,
                  );
              if (
                fixture.stadiumCode &&
                !stadiums.has(fixture.stadiumCode) &&
                !lookupEntity(db, "stadium", fixture.stadiumCode)
              )
                errors.push(
                  `Unknown stadium ${fixture.stadiumCode} in ${stage.code} calendar.`,
                );
            }
          }
        }
      }
  }
  return errors;
}
