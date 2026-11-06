import { MasterController } from "./modules/master/master.controller.js";
import { MasterService } from "./modules/master/master.service.js";
import { SqliteMasterRepository } from "./modules/master/sqlite-master.repository.js";
import { SaveController } from "./modules/saves/save.controller.js";
import { SaveManagerRepository } from "./modules/saves/save-manager.repository.js";
import { SaveService } from "./modules/saves/save.service.js";

export function createContainer() {
  const masterRepository = new SqliteMasterRepository();
  const masterService = new MasterService(masterRepository);
  const saveRepository = new SaveManagerRepository();
  const saveService = new SaveService(saveRepository, masterService);

  return {
    masterController: new MasterController(masterService),
    saveController: new SaveController(saveService),
  };
}

export type ApiContainer = ReturnType<typeof createContainer>;
