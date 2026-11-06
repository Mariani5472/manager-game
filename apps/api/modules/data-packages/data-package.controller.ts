import type { RequestHandler } from "express";
import type { DataPackageService } from "./data-package.service.js";

export class DataPackageController {
  constructor(private readonly dataPackageService: DataPackageService) {}

  listInstalled: RequestHandler = (_request, response) => {
    response.json(this.dataPackageService.listInstalled());
  };
}
