import type { RequestHandler } from "express";
import type { MasterService } from "./master.service.js";
import { countryIdSchema } from "./master.schema.js";

export class MasterController {
  constructor(private readonly masterService: MasterService) {}

  getOverview: RequestHandler = (_request, response) => {
    response.json(this.masterService.getOverview());
  };

  getCountryClubs: RequestHandler = (request, response) => {
    response.json(this.masterService.getCountryClubs(countryIdSchema.parse(request.params.countryId)));
  };
}
