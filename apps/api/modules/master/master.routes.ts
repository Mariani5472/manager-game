import { Router } from "express";
import type { MasterController } from "./master.controller.js";

export function createMasterRoutes(controller: MasterController): Router {
  const router = Router();

  router.get("/overview", controller.getOverview);
  router.get("/countries/:countryId/clubs", controller.getCountryClubs);

  return router;
}
