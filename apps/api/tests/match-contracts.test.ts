import test from "node:test";
import assert from "node:assert/strict";
import {
  FIXTURE_STATUS_TRANSITIONS,
  canTransitionFixtureStatus,
} from "../../shared/src/contracts/match.contracts.js";

test("fixture status transitions allow only the documented lifecycle", () => {
  assert.deepEqual(FIXTURE_STATUS_TRANSITIONS.SCHEDULED, [
    "IN_PROGRESS",
    "POSTPONED",
    "CANCELLED",
  ]);
  assert.equal(canTransitionFixtureStatus("SCHEDULED", "IN_PROGRESS"), true);
  assert.equal(canTransitionFixtureStatus("SCHEDULED", "COMPLETED"), false);
  assert.equal(canTransitionFixtureStatus("POSTPONED", "SCHEDULED"), true);
  assert.equal(canTransitionFixtureStatus("IN_PROGRESS", "COMPLETED"), true);
  assert.equal(canTransitionFixtureStatus("COMPLETED", "IN_PROGRESS"), false);
  assert.equal(canTransitionFixtureStatus("CANCELLED", "SCHEDULED"), false);
});
