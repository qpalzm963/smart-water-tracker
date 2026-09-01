import { Router } from 'express';
import {
  recordWaterEvent,
  listRecords,
  deleteRecord,
  getDailyStats,
  getWeeklyStats,
  getMonthlyStats,
} from '../controllers/waterController';
import { authenticateUser, authenticateUserOrDevice } from '../middleware/auth';

const router = Router();

// Device / App water record upload (accepts either Device Token or User JWT)
router.post('/records', authenticateUserOrDevice, recordWaterEvent);

// User query endpoints (requires User JWT)
router.get('/records', authenticateUser, listRecords);
router.delete('/records/:id', authenticateUser, deleteRecord);
router.get('/stats/daily', authenticateUser, getDailyStats);
router.get('/stats/weekly', authenticateUser, getWeeklyStats);
router.get('/stats/monthly', authenticateUser, getMonthlyStats);

export default router;
