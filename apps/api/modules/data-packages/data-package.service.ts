import type { DataPackageRepository } from "./data-package.repository.js";

export class DataPackageService {
  constructor(private readonly dataPackageRepository: DataPackageRepository) {}

  listInstalled() {
    return { dataPackages: this.dataPackageRepository.listInstalled() };
  }
}
