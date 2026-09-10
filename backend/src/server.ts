import { createApp } from './app';
import { config } from './config/env';
import { initializePersistence } from './repositories';
import { closeMongoConnection } from './database/mongo';

async function startServer(): Promise<void> {
  // Initialize MongoDB Persistence & Indexes
  await initializePersistence();
  console.log(`[Database] MongoDB persistence initialized for: ${config.mongodbDbName}`);

  const app = createApp();

  const server = app.listen(config.port, () => {
    console.log(`================================================`);
    console.log(`🥤 Smart Water Tracker Backend is running!`);
    console.log(`🚀 URL: http://localhost:${config.port}`);
    console.log(`🩺 Health: http://localhost:${config.port}/api/v1/health`);
    console.log(`================================================`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await closeMongoConnection();
      console.log('[Server] Database connection closed. Server exited cleanly.');
      process.exit(0);
    });

    // Force kill if graceful close exceeds 5 seconds
    setTimeout(() => {
      console.error('[Server] Forced shutdown after timeout.');
      process.exit(1);
    }, 5000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('[Server] Failed to start:', err);
  process.exit(1);
});
