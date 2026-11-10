import type { RequestHandler } from "express";
import type { CampaignService } from "./campaign.service.js";
import { advanceMatchSchema, fixtureIdSchema, saveIdSchema, saveMatchLineupSchema, tacticalChangeSchema } from "./campaign.schema.js";

export class CampaignController {
  constructor(private readonly service: CampaignService) {}

  overview: RequestHandler = (request, response) => response.json(this.service.overview(saveIdSchema.parse(request.params.saveId)));
  calendar: RequestHandler = (request, response) => response.json(this.service.calendar(saveIdSchema.parse(request.params.saveId)));
  squad: RequestHandler = (request, response) => response.json(this.service.squad(saveIdSchema.parse(request.params.saveId)));
  team: RequestHandler = (request, response) => response.json(this.service.team(saveIdSchema.parse(request.params.saveId)));
  matchPreparation: RequestHandler = (request, response) => response.json(this.service.matchPreparation(saveIdSchema.parse(request.params.saveId), fixtureIdSchema.parse(request.params.fixtureId)));
  saveMatchLineup: RequestHandler = (request, response) => response.json(this.service.saveMatchLineup(saveIdSchema.parse(request.params.saveId), fixtureIdSchema.parse(request.params.fixtureId), saveMatchLineupSchema.parse(request.body)));
  matchCenter: RequestHandler = (request, response) => response.json(this.service.matchCenter(saveIdSchema.parse(request.params.saveId), fixtureIdSchema.parse(request.params.fixtureId)));
  matchHistory: RequestHandler = (request, response) => response.json(this.service.matchHistory(saveIdSchema.parse(request.params.saveId), fixtureIdSchema.parse(request.params.fixtureId)));
  advanceMatch: RequestHandler = (request, response) => response.json(this.service.advanceMatch(saveIdSchema.parse(request.params.saveId), fixtureIdSchema.parse(request.params.fixtureId), advanceMatchSchema.parse(request.body).throughMinute));
  scheduleTacticalChange: RequestHandler = (request, response) => response.status(201).json(this.service.scheduleTacticalChange(saveIdSchema.parse(request.params.saveId), fixtureIdSchema.parse(request.params.fixtureId), tacticalChangeSchema.parse(request.body)));
}
