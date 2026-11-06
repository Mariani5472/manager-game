import type { RequestHandler } from "express";
import { z } from "zod";
import type { MasterService } from "./master.service.js";

const countryIdSchema = z.coerce.number().int().positive();

export class MasterController {
  constructor(private readonly masterService: MasterService) {}

  getOverview: RequestHandler = (_request, response) => {
    response.json(this.masterService.getOverview());
  };

  getCountryClubs: RequestHandler = (request, response) => {
    const countryId = countryIdSchema.parse(request.params.countryId);
    response.json(this.masterService.getCountryClubs(countryId));
  };
}
