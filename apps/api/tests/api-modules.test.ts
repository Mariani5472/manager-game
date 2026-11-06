import assert from "node:assert/strict";
import test from "node:test";
import type { MasterRepository } from "../modules/master/master.repository.js";
import { MasterService } from "../modules/master/master.service.js";
import type { SaveRepository } from "../modules/saves/save.repository.js";
import { SaveService } from "../modules/saves/save.service.js";
import { ApplicationError } from "../shared/application-error.js";

function createMasterRepository(countryId: number | null = 10): MasterRepository {
  return {
    listCountries: () => [],
    findCountryClubs: () => null,
    findClubCountryId: () => countryId,
  };
}

test("MasterService rejects a club that does not belong to the selected country", () => {
  const service = new MasterService(createMasterRepository(20));

  assert.throws(
    () => service.assertClubBelongsToCountry(5, 10),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.statusCode === 400 &&
      error.code === "CLUB_COUNTRY_MISMATCH",
  );
});

test("MasterService rejects a club that does not exist", () => {
  const service = new MasterService(createMasterRepository(null));

  assert.throws(
    () => service.assertClubBelongsToCountry(999, 10),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "CLUB_COUNTRY_MISMATCH",
  );
});

test("SaveService validates the club-country relationship before creating a save", async () => {
  let createCalled = false;
  const saveRepository: SaveRepository = {
    list: () => [],
    create: async (input) => {
      createCalled = true;
      return {
        id: "save-id",
        name: input.saveName,
        managerName: input.managerName,
        clubId: input.clubId,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
    },
    open: () => undefined,
  };
  const service = new SaveService(
    saveRepository,
    new MasterService(createMasterRepository(10)),
  );

  const result = await service.createCareer({
    managerName: "Alex",
    saveName: "First Career",
    countryId: 10,
    clubId: 5,
  });

  assert.equal(createCalled, true);
  assert.equal(result.name, "First Career");
});

test("SaveService does not create a save when the club-country relationship is invalid", async () => {
  let createCalled = false;
  const saveRepository: SaveRepository = {
    list: () => [],
    create: async () => {
      createCalled = true;
      throw new Error("Repository should not be called.");
    },
    open: () => undefined,
  };
  const service = new SaveService(
    saveRepository,
    new MasterService(createMasterRepository(20)),
  );

  await assert.rejects(
    service.createCareer({
      managerName: "Alex",
      saveName: "Invalid Career",
      countryId: 10,
      clubId: 5,
    }),
    (error: unknown) =>
      error instanceof ApplicationError &&
      error.code === "CLUB_COUNTRY_MISMATCH",
  );
  assert.equal(createCalled, false);
});
