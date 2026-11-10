import { Router } from "express";
import type { CampaignController } from "./campaign.controller.js";
export function createCampaignRoutes(controller: CampaignController): Router {
  const router = Router();
  router.get("/:saveId/campaign/overview", controller.overview);
  router.get("/:saveId/campaign/calendar", controller.calendar);
  router.get("/:saveId/competitions/:stageId", controller.competition);
  router.get("/:saveId/campaign/squad", controller.squad);
  router.get("/:saveId/campaign/team", controller.team);
  router.get(
    "/:saveId/matches/:fixtureId/preparation",
    controller.matchPreparation,
  );
  router.put("/:saveId/matches/:fixtureId/lineup", controller.saveMatchLineup);
  router.get("/:saveId/matches/:fixtureId/center", controller.matchCenter);
  router.get("/:saveId/matches/:fixtureId/history", controller.matchHistory);
  router.post("/:saveId/matches/:fixtureId/advance", controller.advanceMatch);
  router.post(
    "/:saveId/matches/:fixtureId/decisions",
    controller.scheduleTacticalChange,
  );
  return router;
}
