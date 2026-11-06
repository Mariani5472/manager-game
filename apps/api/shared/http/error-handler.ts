import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { ApplicationError } from "../application-error.js";

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ZodError) {
    response.status(400).json({
      error: "Request validation failed.",
      code: "VALIDATION_ERROR",
      issues: error.issues,
    });
    return;
  }

  if (error instanceof ApplicationError) {
    response.status(error.statusCode).json({
      error: error.message,
      code: error.code,
    });
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected API error.";
  response.status(500).json({ error: message, code: "INTERNAL_SERVER_ERROR" });
};
