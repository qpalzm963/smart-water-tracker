import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { getDatabase } from '../database/db';
import { AuthenticatedRequest, User, UserResponse } from '../types';
import { usernameFromLegacyEmail } from '../utils/username';

const updateProfileSchema = z.object({
  displayName: z.string().optional(),
  dailyGoalMl: z.number().int().min(100).max(10000).optional(),
});

export function getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as User | undefined;
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const response: UserResponse = {
      id: user.id,
      username: user.username || usernameFromLegacyEmail(user.email, user.id),
      email: user.email,
      displayName: user.display_name,
      dailyGoalMl: user.daily_goal_ml,
      createdAt: user.created_at,
    };

    res.status(200).json({ user: response });
  } catch (err) {
    next(err);
  }
}

export function updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { displayName, dailyGoalMl } = updateProfileSchema.parse(req.body);
    const db = getDatabase();
    const now = new Date().toISOString();

    const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as unknown as User | undefined;
    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updatedDisplayName = displayName !== undefined ? displayName : currentUser.display_name;
    const updatedDailyGoal = dailyGoalMl !== undefined ? dailyGoalMl : currentUser.daily_goal_ml;

    db.prepare(
      `UPDATE users
       SET display_name = ?, daily_goal_ml = ?, updated_at = ?
       WHERE id = ?`
    ).run(updatedDisplayName, updatedDailyGoal, now, userId);

    const response: UserResponse = {
      id: userId,
      username: currentUser.username || usernameFromLegacyEmail(currentUser.email, currentUser.id),
      email: currentUser.email,
      displayName: updatedDisplayName,
      dailyGoalMl: updatedDailyGoal,
      createdAt: currentUser.created_at,
    };

    res.status(200).json({ user: response });
  } catch (err) {
    next(err);
  }
}
