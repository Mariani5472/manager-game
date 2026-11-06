import type { RequestHandler } from "express";
import { z } from "zod";
import type { CreateCareerRequest } from "../../../shared/src/index.js";
import type { SaveService } from "./save.service.js";

const createCareerSchema = z.object({
  managerName: z.string().trim().min(2).max(60),
  saveName: z.string().trim().min(2).max(80),
  countryId: z.coerce.number().int().positive(),
  clubId: z.coerce.number().int().positive(),
});

const saveIdSchema = z.string().uuid();

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
