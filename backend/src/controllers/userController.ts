import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { getRepositoryContainer } from '../repositories';
import { AuthenticatedRequest, UserResponse } from '../types';
import { usernameFromLegacyEmail } from '../utils/username';

const updateProfileSchema = z.object({
  displayName: z.string().optional(),
  dailyGoalMl: z.number().int().min(100).max(10000).optional(),
});

export async function getProfile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { userRepository } = await getRepositoryContainer();
    const user = await userRepository.findById(userId);
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

export async function updateProfile(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { displayName, dailyGoalMl } = updateProfileSchema.parse(req.body);
    const { userRepository } = await getRepositoryContainer();

    const currentUser = await userRepository.findById(userId);
    if (!currentUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const updatedUser = await userRepository.updateProfile(userId, {
      displayName,
      dailyGoalMl,
    });

    if (!updatedUser) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const response: UserResponse = {
      id: userId,
      username: updatedUser.username || usernameFromLegacyEmail(updatedUser.email, updatedUser.id),
      email: updatedUser.email,
      displayName: updatedUser.display_name,
      dailyGoalMl: updatedUser.daily_goal_ml,
      createdAt: updatedUser.created_at,
    };

    res.status(200).json({ user: response });
  } catch (err) {
    next(err);
  }
}
