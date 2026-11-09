import type {RequestHandler} from "express";
import type {CampaignService} from "./campaign.service.js";
import { uuidSchema } from "./campaign.schema.js";

export class CampaignController {
 constructor(private readonly service:CampaignService){}
 overview:RequestHandler=(req,res)=>res.json(this.service.overview(uuidSchema.parse(req.params.saveId)));
 calendar:RequestHandler=(req,res)=>res.json(this.service.calendar(uuidSchema.parse(req.params.saveId)));
 squad:RequestHandler=(req,res)=>res.json(this.service.squad(uuidSchema.parse(req.params.saveId)));
 team:RequestHandler=(req,res)=>res.json(this.service.team(uuidSchema.parse(req.params.saveId)));
}