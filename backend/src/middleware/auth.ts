import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env';
import { getRepositoryContainer } from '../repositories';
import { AuthenticatedRequest, JwtUserPayload } from '../types';

export function authenticateUser(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7).trim();

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtUserPayload;
    req.user = { id: decoded.userId, username: decoded.username, email: decoded.email };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export async function authenticateDevice(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header for device' });
    return;
  }

  const token = authHeader.substring(7).trim();

  try {
    const { deviceRepository } = await getRepositoryContainer();
    const device = await deviceRepository.findByToken(token);

    if (!device) {
      res.status(401).json({ error: 'Unauthorized device token' });
      return;
    }

    req.device = { id: device.id, userId: device.user_id };
    req.user = { id: device.user_id };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Allows either User JWT or Device Token.
 * Fast-path: checks cryptographically verified JWT first; if failed, checks Device Token in DB.
 */
export async function authenticateUserOrDevice(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const token = authHeader.substring(7).trim();

  // 1. Try JWT
  try {
    const decoded = jwt.verify(token, config.jwtSecret) as JwtUserPayload;
    req.user = { id: decoded.userId, username: decoded.username, email: decoded.email };
    return next();
  } catch {
    // Not a valid JWT, fallback to Device Token
  }

  // 2. Try Device Token
  try {
    const { deviceRepository } = await getRepositoryContainer();
    const device = await deviceRepository.findByToken(token);

    if (device) {
      req.device = { id: device.id, userId: device.user_id };
      req.user = { id: device.user_id };
      return next();
    }

    res.status(401).json({ error: 'Invalid token (neither valid user JWT nor device token)' });
  } catch (err) {
    next(err);
  }
}
