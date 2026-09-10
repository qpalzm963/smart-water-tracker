import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { sanitizeErrorMessage } from '../utils/sanitize';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation error',
      details: err.errors.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
    return;
  }

  const sanitizedMessage = sanitizeErrorMessage(err);

  console.error('Unhandled error:', sanitizedMessage);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : sanitizedMessage,
  });
}
