import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

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

  const rawMessage = err instanceof Error ? err.message : String(err);
  const sanitizedMessage = rawMessage
    .replace(/mongodb(?:\+srv)?:\/\/[^\s@]+@/gi, 'mongodb+srv://***:***@')
    .replace(/dvt_[a-f0-9]{32,64}/gi, 'dvt_***');

  console.error('Unhandled error:', sanitizedMessage);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : sanitizedMessage,
  });
}
