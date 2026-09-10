import { MongoMemoryServer } from 'mongodb-memory-server';

let fallbackMongoServer: MongoMemoryServer | null = null;

export async function getTestMongoUri(): Promise<string> {
  if (process.env.TEST_MONGO_URI) {
    return process.env.TEST_MONGO_URI;
  }
  if (!fallbackMongoServer) {
    fallbackMongoServer = await MongoMemoryServer.create();
  }
  return fallbackMongoServer.getUri();
}

export async function stopSharedTestMongoServer(): Promise<void> {
  if (fallbackMongoServer) {
    await fallbackMongoServer.stop();
    fallbackMongoServer = null;
  }
}
