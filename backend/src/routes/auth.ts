import { Router } from 'express';
import { register, login } from '../controllers/authController';
import { loginLimiter, registerLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);

export default router;
