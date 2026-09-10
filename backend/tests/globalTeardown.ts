export default async function globalTeardown(): Promise<void> {
  const mongod = (globalThis as any).__MONGOD__;
  if (mongod) {
    await mongod.stop();
  }
}
