import { z } from "zod";

export const createCareerSchema = z.object({
  managerName: z.string().trim().min(2).max(60),
  saveName: z.string().trim().min(2).max(80),
  countryId: z.coerce.number().int().positive(),
  clubId: z.coerce.number().int().positive(),
});

export const saveIdSchema = z.uuid();
export type CreateCareerInput = z.infer<typeof createCareerSchema>;
