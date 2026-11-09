import type { RequestHandler } from "express";
import type { CreateCareerRequest } from "../../../shared/src/index.js";
import type { SaveService } from "./save.service.js";
import { createCareerSchema, saveIdSchema } from "./save.schema.js";

export class SaveController {
  constructor(private readonly saveService: SaveService) {}

  list: RequestHandler = (_request, response) => {
    response.json({ saves: this.saveService.list() });
  };

  create: RequestHandler = async (request, response) => {
    const input = createCareerSchema.parse(request.body) as CreateCareerRequest;
    const save = await this.saveService.createCareer(input);
    response.status(201).json({ save });
  };

  open: RequestHandler = (request, response) => {
    const saveId = saveIdSchema.parse(request.params.saveId);
    this.saveService.open(saveId);
    response.json({ opened: true, saveId });
  };
}
