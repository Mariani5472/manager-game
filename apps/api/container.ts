import { DataPackageController } from "./modules/data-packages/data-package.controller.js";
import { SqliteDataPackageRepository } from "./modules/data-packages/repo/sqlite-data-package.repository.js";
import { DataPackageService } from "./modules/data-packages/data-package.service.js";
import { MasterController } from "./modules/master/master.controller.js";
import { MasterService } from "./modules/master/master.service.js";
import { SqliteMasterRepository } from "./modules/master/repo/sqlite-master.repository.js";
import { SaveController } from "./modules/saves/save.controller.js";
import { SaveManagerRepository } from "./modules/saves/repo/save-manager.repository.js";
import { SaveService } from "./modules/saves/save.service.js";
import { CampaignController } from "./modules/campaign/campaign.controller.js";
import { CampaignService } from "./modules/campaign/campaign.service.js";
import { SqliteCampaignRepository } from "./modules/campaign/repo/sqlite-campaign.repository.js";

export function createContainer() {
  const masterRepository = new SqliteMasterRepository();
  const masterService = new MasterService(masterRepository);

  const saveRepository = new SaveManagerRepository();
  const saveService = new SaveService(saveRepository, masterService);

  const dataPackageRepository = new SqliteDataPackageRepository();
  const dataPackageService = new DataPackageService(dataPackageRepository);

  const campaignService = new CampaignService(new SqliteCampaignRepository());

  return {
    masterController: new MasterController(masterService),
    saveController: new SaveController(saveService),
    dataPackageController: new DataPackageController(dataPackageService),
    campaignController: new CampaignController(campaignService),
  };
}

export type ApiContainer = ReturnType<typeof createContainer>;
