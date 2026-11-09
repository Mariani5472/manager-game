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
