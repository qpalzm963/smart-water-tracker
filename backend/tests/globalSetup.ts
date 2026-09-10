import { MongoMemoryServer } from 'mongodb-memory-server';

export default async function globalSetup(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  (globalThis as any).__MONGOD__ = mongod;
  const uri = mongod.getUri();
  process.env.TEST_MONGO_URI = uri;
  process.env.MONGODB_URI = uri;
}
