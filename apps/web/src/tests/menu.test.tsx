import { describe, expect, it } from "vitest";
import { newGameSchema } from "../lib/schemas";

describe("newGameSchema", () => {
  it("accepts a valid manager and club", () => {
    expect(newGameSchema.parse({ managerName: "Alex", saveName: "First season", clubId: "2" })).toEqual({
      managerName: "Alex",
      saveName: "First season",
      clubId: 2,
    });
  });

  it("rejects an invalid club id", () => {
    expect(newGameSchema.safeParse({ managerName: "A", saveName: "Season", clubId: 0 }).success).toBe(false);
  });
});
