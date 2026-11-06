import { Router } from "express";
import type { DataPackageController } from "./data-package.controller.js";

export function createDataPackageRoutes(controller: DataPackageController): Router {
  const router = Router();

  router.get("/installed", controller.listInstalled);

  return router;
}
