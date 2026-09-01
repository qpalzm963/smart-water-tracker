import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { config } from '../config/env';
import { getDatabase } from '../database/db';
import { User, UserResponse } from '../types';
import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  isValidUsername,
  normalizeUsername,
  usernameFromLegacyEmail,
} from '../utils/username';

const registerSchema = z.object({
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
}).refine((input) => Boolean(input.username || input.email), {
  path: ['username'],
  message: 'Username is required',
});

const loginSchema = z.object({
  username: z.string().trim().min(1, 'Username is required').max(254).optional(),
  // Legacy clients may continue sending email until they update their app.
  email: z.string().trim().min(1).max(254).optional(),
  password: z.string().min(1, 'Password is required'),
}).refine((input) => Boolean(input.username || input.email), {
  path: ['username'],
  message: 'Username is required',
});

export async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { username: rawUsername, email, password, displayName } = registerSchema.parse(req.body);
    const db = getDatabase();

    const userId = uuidv4();
    const username = rawUsername || usernameFromLegacyEmail(email, userId);

    const existingUser = db
      .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
      .get(username);
    if (existingUser) {
      res.status(409).json({ error: 'Username is already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();
    // `email` remains populated for old schemas where the column is NOT NULL.
    const legacyEmail = email || username;

    db.prepare(
      `INSERT INTO users (id, username, email, password_hash, display_name, daily_goal_ml, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(userId, username, legacyEmail, passwordHash, displayName || null, 2000, now, now);

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
    const db = getDatabase();

    const user = db
      .prepare(
        `SELECT * FROM users
         WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
         LIMIT 1`,
      )
      .get(identifier, identifier) as unknown as User | undefined;
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
