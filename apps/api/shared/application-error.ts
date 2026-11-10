export class ApplicationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApplicationError";
  }

  static notFound(
    message: string,
    code = "RESOURCE_NOT_FOUND",
  ): ApplicationError {
    return new ApplicationError(message, 404, code);
  }

  static conflict(
    message: string,
    code = "RESOURCE_CONFLICT",
  ): ApplicationError {
    return new ApplicationError(message, 409, code);
  }

  static badRequest(
    message: string,
    code = "INVALID_REQUEST",
  ): ApplicationError {
    return new ApplicationError(message, 400, code);
  }
}
