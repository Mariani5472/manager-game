import {Router} from "express";
import type {CampaignController} from "./campaign.controller.js";
export function createCampaignRoutes(controller:CampaignController):Router {
 const router=Router();
 router.get("/:saveId/campaign/overview",controller.overview);
 router.get("/:saveId/campaign/calendar",controller.calendar);
 router.get("/:saveId/campaign/squad",controller.squad);
 router.get("/:saveId/campaign/team",controller.team);
 return router;
}