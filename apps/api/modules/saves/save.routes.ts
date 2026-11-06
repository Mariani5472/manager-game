import { Router } from "express";
import type { SaveController } from "./save.controller.js";

export function createSaveRoutes(controller: SaveController): Router {
  const router = Router();

  router.get("/", controller.list);
  router.post("/", controller.create);
  router.post("/:saveId/open", controller.open);

  return router;
}
