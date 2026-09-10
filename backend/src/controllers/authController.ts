import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { config } from '../config/env';
import { getRepositoryContainer } from '../repositories';
import { UserResponse } from '../types';
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isValidUsername,
  normalizeUsername,
  usernameFromLegacyEmail,
} from '../utils/username';

const registerSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(USERNAME_MIN_LENGTH, `Username must be at least ${USERNAME_MIN_LENGTH} characters long`)
      .max(USERNAME_MAX_LENGTH, `Username must be at most ${USERNAME_MAX_LENGTH} characters long`)
      .transform(normalizeUsername)
      .refine(isValidUsername, 'Username may only contain letters, numbers, ., _, or -')
      .optional(),
    // Accepted temporarily so older clients can still create accounts during the migration.
    email: z.string().trim().email('Invalid email format').optional(),
    password: z.string().min(6, 'Password must be at least 6 characters long'),
    displayName: z.string().optional(),
  })
  .refine((input) => Boolean(input.username || input.email), {
    path: ['username'],
    message: 'Username is required',
  });

const loginSchema = z
  .object({
    username: z.string().trim().min(1, 'Username is required').max(254).optional(),
    // Legacy clients may continue sending email until they update their app.
    email: z.string().trim().min(1).max(254).optional(),
    password: z.string().min(1, 'Password is required'),
  })
  .refine((input) => Boolean(input.username || input.email), {
    path: ['username'],
    message: 'Username is required',
  });

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username: rawUsername, email, password, displayName } = registerSchema.parse(req.body);
    const { userRepository } = await getRepositoryContainer();

    const userId = uuidv4();
    const username = rawUsername || usernameFromLegacyEmail(email, userId);

    const existingUser = await userRepository.findByUsernameOrEmail(username);
    if (existingUser) {
      res.status(409).json({ error: 'Username is already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    const legacyEmail = email || username;

    try {
      await userRepository.create({
        id: userId,
        username,
        email: legacyEmail,
        passwordHash,
        displayName: displayName || null,
        dailyGoalMl: 2000,
        createdAt: now,
        updatedAt: now,
      });
    } catch (err: any) {
      if (err.code === 'DUPLICATE_USERNAME') {
        res.status(409).json({ error: 'Username is already registered' });
        return;
      }
      throw err;
    }

    const token = jwt.sign({ userId, username, email: legacyEmail }, config.jwtSecret, { expiresIn: '30d' });

    const userResponse: UserResponse = {
      id: userId,
      username,
      email: legacyEmail,
      displayName: displayName || null,
      dailyGoalMl: 2000,
      createdAt: now,
    };

    res.status(201).json({
      token,
      user: userResponse,
    });
  } catch (err) {
    next(err);
  }
}

export async function login(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username: rawUsername, email: legacyEmail, password } = loginSchema.parse(req.body);
    const identifier = normalizeUsername(rawUsername || legacyEmail || '');
    const { userRepository } = await getRepositoryContainer();

    const user = await userRepository.findByUsernameOrEmail(identifier);
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const username = user.username || usernameFromLegacyEmail(user.email, user.id);
    const token = jwt.sign({ userId: user.id, username, email: user.email }, config.jwtSecret, {
      expiresIn: '30d',
    });

    const userResponse: UserResponse = {
      id: user.id,
      username,
      email: user.email,
      displayName: user.display_name,
      dailyGoalMl: user.daily_goal_ml,
      createdAt: user.created_at,
    };

    res.status(200).json({
      token,
      user: userResponse,
    });
  } catch (err) {
    next(err);
  }
}
