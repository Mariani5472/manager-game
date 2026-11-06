import type {RequestHandler} from "express";
import {z} from "zod";
import type {CampaignService} from "./campaign.service.js";
const schema=z.string().uuid();
export class CampaignController {
 constructor(private readonly service:CampaignService){}
 overview:RequestHandler=(req,res)=>res.json(this.service.overview(schema.parse(req.params.saveId)));
 calendar:RequestHandler=(req,res)=>res.json(this.service.calendar(schema.parse(req.params.saveId)));
 squad:RequestHandler=(req,res)=>res.json(this.service.squad(schema.parse(req.params.saveId)));
 team:RequestHandler=(req,res)=>res.json(this.service.team(schema.parse(req.params.saveId)));
}