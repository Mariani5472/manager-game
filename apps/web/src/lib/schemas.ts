import { z } from 'zod';

export const newGameSchema = z.object({
  managerName: z.string().trim().min(2, 'Enter at least 2 characters.'),
  saveName: z.string().trim().min(2, 'Enter at least 2 characters.'),
  clubId: z.coerce.number().int().positive('Choose a club.'),
});

export type NewGameInput = z.input<typeof newGameSchema>;
export type NewGameOutput = z.output<typeof newGameSchema>;
