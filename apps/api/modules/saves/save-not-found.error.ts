export class SaveNotFoundError extends Error {
  constructor(saveId: string) {
    super(`Campaign save "${saveId}" was not found.`);
    this.name = "SaveNotFoundError";
  }
}
