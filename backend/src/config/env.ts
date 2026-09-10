import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET;

if (nodeEnv === 'production' && (!jwtSecret || jwtSecret.includes('super_secret_jwt_key') || jwtSecret.length < 16)) {
  throw new Error(
    '[FATAL SECURITY ERROR] In production, JWT_SECRET must be set to a strong random secret in your .env file. Server refusing to start.'
  );
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  jwtSecret: jwtSecret || 'smart_water_tracker_dev_insecure_jwt_secret_change_in_prod',
  databasePath: process.env.DATABASE_PATH || './data/water_tracker.db',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/water_tracker',
  mongodbDbName: process.env.MONGODB_DB_NAME || 'water_tracker',
  timezone: 'Asia/Taipei',
};
