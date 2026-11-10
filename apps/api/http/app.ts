import express from "express";
import cors from "cors";
import type { ApiContainer } from "../container.js";
import { createContainer } from "../container.js";
import { errorHandler } from "../shared/http/error-handler.js";
import { createDataPackageRoutes } from "../modules/data-packages/data-package.routes.js";
import { createMasterRoutes } from "../modules/master/master.routes.js";
import { createSaveRoutes } from "../modules/saves/save.routes.js";
import { createCampaignRoutes } from "../modules/campaign/campaign.routes.js";

export function createApp(container: ApiContainer = createContainer()) {
  const app = express();
  const allowedOrigins = (process.env.WEB_ORIGIN ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable("x-powered-by");
  app.use(cors({ origin: allowedOrigins.length > 0 ? allowedOrigins : false }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", service: "manager-game-api" });
  });

  app.use("/api/master", createMasterRoutes(container.masterController));
  app.use(
    "/api/data-packages",
    createDataPackageRoutes(container.dataPackageController),
  );
  app.use("/api/saves", createSaveRoutes(container.saveController));
  app.use("/api/saves", createCampaignRoutes(container.campaignController));

  app.use((_request, response) => {
    response
      .status(404)
      .json({ error: "Route not found.", code: "ROUTE_NOT_FOUND" });
  });

  app.use(errorHandler);
  return app;
}
