import { Db } from 'mongodb';
import { getMongoDb } from '../database/mongo';
import {
  IUserRepository,
  IDeviceRepository,
  IWaterRecordRepository,
  IDeletedWaterEventRepository,
} from './interfaces';
import { MongoUserRepository } from './mongo/MongoUserRepository';
import { MongoDeviceRepository } from './mongo/MongoDeviceRepository';
import { MongoWaterRecordRepository } from './mongo/MongoWaterRecordRepository';
import { MongoDeletedWaterEventRepository } from './mongo/MongoDeletedWaterEventRepository';

export * from './interfaces';
export * from './mongo/MongoUserRepository';
export * from './mongo/MongoDeviceRepository';
export * from './mongo/MongoWaterRecordRepository';
export * from './mongo/MongoDeletedWaterEventRepository';

export interface RepositoryContainer {
  userRepository: IUserRepository;
  deviceRepository: IDeviceRepository;
  waterRecordRepository: IWaterRecordRepository;
  deletedWaterEventRepository: IDeletedWaterEventRepository;
}

let activeContainer: RepositoryContainer | null = null;

export function setRepositoryContainer(
  container: RepositoryContainer | null
): void {
  activeContainer = container;
}

export async function getRepositoryContainer(
  db?: Db
): Promise<RepositoryContainer> {
  if (activeContainer && !db) {
    return activeContainer;
  }
  const targetDb = db || (await getMongoDb());
  const container: RepositoryContainer = {
    userRepository: new MongoUserRepository(targetDb),
    deviceRepository: new MongoDeviceRepository(targetDb),
    waterRecordRepository: new MongoWaterRecordRepository(targetDb),
    deletedWaterEventRepository: new MongoDeletedWaterEventRepository(targetDb),
  };
  if (!activeContainer) {
    activeContainer = container;
  }
  return container;
}
