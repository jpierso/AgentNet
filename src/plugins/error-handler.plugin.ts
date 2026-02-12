import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public error: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: Error & { validation?: unknown; statusCode?: number }, _request: FastifyRequest, reply: FastifyReply) => {
    // Zod / Fastify validation errors
    if ('validation' in error || (error.statusCode && error.statusCode === 400)) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Validation Error',
        message: error.message,
      } satisfies ApiError);
    }

    // Application errors
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        statusCode: error.statusCode,
        error: error.error,
        message: error.message,
        details: error.details,
      } satisfies ApiError);
    }

    // Unexpected errors
    app.log.error(error);
    return reply.status(500).send({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
    } satisfies ApiError);
  });
});
