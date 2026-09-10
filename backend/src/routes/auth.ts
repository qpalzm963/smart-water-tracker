import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { register, login } from '../controllers/authController';

const router = Router();

// Rate limiting to prevent brute-force attacks and CPU exhaustion on bcrypt
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 attempts per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again after 1 minute.' },
  skip: () => process.env.NODE_ENV === 'test',
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 15, // 15 registrations per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);

export default router;
