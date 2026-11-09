import { z } from "zod";

export const saveIdSchema = z.uuid();
export const fixtureIdSchema = z.coerce.number().int().positive();

export const saveMatchLineupSchema = z.object({
  starterIds: z.array(z.number().int().positive()).length(11),
  benchIds: z.array(z.number().int().positive()).max(7),
}).superRefine(({ starterIds, benchIds }, context) => {
  if (new Set([...starterIds, ...benchIds]).size !== starterIds.length + benchIds.length) {
    context.addIssue({ code: "custom", message: "A player cannot appear twice in a lineup or bench." });
  }
});

export const advanceMatchSchema = z.object({
  throughMinute: z.number().int().min(1).max(90),
});

export type SaveMatchLineupInput = z.infer<typeof saveMatchLineupSchema>;
export type AdvanceMatchInput = z.infer<typeof advanceMatchSchema>;

export const tacticalChangeSchema = z.discriminatedUnion("type", [
  z.object({
    minute: z.number().int().min(1).max(90),
    type: z.literal("MENTALITY"),
    mentality: z.enum(["VERY_DEFENSIVE", "DEFENSIVE", "BALANCED", "ATTACKING", "VERY_ATTACKING"]),
  }),
  z.object({
    minute: z.number().int().min(1).max(90),
    type: z.literal("INSTRUCTION"),
    key: z.enum(["pressing", "tempo", "defensive_line", "width", "passing_directness", "counter_attack"]),
    value: z.number().finite(),
  }).superRefine(({ key, value }, context) => {
    const maximum = key === "counter_attack" ? 1 : 100;
    if (value < 0 || value > maximum) {
      context.addIssue({ code: "custom", message: `${key} must be between 0 and ${maximum}.` });
    }
  }),
  z.object({
    minute: z.number().int().min(1).max(90),
    type: z.literal("SUBSTITUTION"),
    playerOutId: z.number().int().positive(),
    playerInId: z.number().int().positive(),
  }).refine(({ playerOutId, playerInId }) => playerOutId !== playerInId, {
    message: "Incoming and outgoing players must be different.",
  }),
  z.object({
    minute: z.number().int().min(1).max(90),
    type: z.literal("FORMATION"),
    formationId: z.number().int().positive(),
  }),
]);

export type TacticalChangeInput = z.infer<typeof tacticalChangeSchema>;

