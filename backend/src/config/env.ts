import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET;
const mongodbUri = process.env.MONGODB_URI;

export function isInvalidProductionJwtSecret(secret: string | undefined): boolean {
  if (!secret) return true;
  if (secret.length < 16) return true;
  if (secret.includes('super_secret_jwt_key')) return true;
  if (secret.toLowerCase().startsWith('replace_') || secret.includes('replace_with_a_strong_random_secret')) return true;
  if (/^(your_jwt_secret|change_in_prod|default_secret)/i.test(secret)) return true;
  return false;
}

if (nodeEnv === 'production' && isInvalidProductionJwtSecret(jwtSecret)) {
  throw new Error(
    '[FATAL SECURITY ERROR] In production, JWT_SECRET must be set to a strong random secret in your .env file. Server refusing to start.'
  );
}

if (nodeEnv === 'production' && !mongodbUri) {
  throw new Error(
    '[FATAL CONFIG ERROR] In production, MONGODB_URI must be configured. Server refusing to start.'
  );
}

export function parseAllowedOrigins(originsEnv: string | undefined): string[] {
  if (!originsEnv) return [];
  return originsEnv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv,
  jwtSecret: jwtSecret || 'smart_water_tracker_dev_insecure_jwt_secret_change_in_prod',
  databasePath: process.env.DATABASE_PATH || './data/water_tracker.db',
  mongodbUri: mongodbUri || 'mongodb://127.0.0.1:27017/water_tracker',
  mongodbDbName: process.env.MONGODB_DB_NAME || 'water_tracker',
  allowedOrigins: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  timezone: 'Asia/Taipei',
};

