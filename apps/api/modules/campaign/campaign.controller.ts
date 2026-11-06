import type {RequestHandler} from "express";
import {z} from "zod";
import type {CampaignService} from "./campaign.service.js";
const schema=z.string().uuid();
const fixtureIdSchema=z.coerce.number().int().positive();
const lineupSchema=z.object({starterIds:z.array(z.number().int().positive()).length(11),benchIds:z.array(z.number().int().positive()).max(7)});
const advanceSchema=z.object({throughMinute:z.number().int().min(1).max(90)});
export class CampaignController {
 constructor(private readonly service:CampaignService){}
 overview:RequestHandler=(req,res)=>res.json(this.service.overview(schema.parse(req.params.saveId)));
 calendar:RequestHandler=(req,res)=>res.json(this.service.calendar(schema.parse(req.params.saveId)));
 squad:RequestHandler=(req,res)=>res.json(this.service.squad(schema.parse(req.params.saveId)));
 team:RequestHandler=(req,res)=>res.json(this.service.team(schema.parse(req.params.saveId)));
 matchPreparation:RequestHandler=(req,res)=>res.json(this.service.matchPreparation(schema.parse(req.params.saveId),fixtureIdSchema.parse(req.params.fixtureId)));
 saveMatchLineup:RequestHandler=(req,res)=>res.json(this.service.saveMatchLineup(schema.parse(req.params.saveId),fixtureIdSchema.parse(req.params.fixtureId),lineupSchema.parse(req.body)));
 matchCenter:RequestHandler=(req,res)=>res.json(this.service.matchCenter(schema.parse(req.params.saveId),fixtureIdSchema.parse(req.params.fixtureId)));
 advanceMatch:RequestHandler=(req,res)=>res.json(this.service.advanceMatch(schema.parse(req.params.saveId),fixtureIdSchema.parse(req.params.fixtureId),advanceSchema.parse(req.body).throughMinute));
}