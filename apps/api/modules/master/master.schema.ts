import { z } from "zod";

export const countryIdSchema = z.coerce.number().int().positive();
export type CountryId = z.infer<typeof countryIdSchema>;
