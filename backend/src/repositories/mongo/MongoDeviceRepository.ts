import { Collection, Db } from 'mongodb';
import {
  IDeviceRepository,
  CreateDeviceInput,
  ClaimDeviceInput,
} from '../interfaces';
import { Device } from '../../types';
import {
  MONGO_COLLECTIONS,
  MongoDeviceDoc,
  MongoDrinkRecordDoc,
} from '../../database/mongoCollections';

export function toDeviceDomain(doc: MongoDeviceDoc): Device {
  return {
    id: doc._id,
    user_id: doc.userId,
    device_token: doc.deviceToken,
    claim_code: doc.claimCode,
    name: doc.name,
    last_seen_at: doc.lastSeenAt,
    created_at: doc.createdAt,
  };
}

export class MongoDeviceRepository implements IDeviceRepository {
  private collection: Collection<MongoDeviceDoc>;
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    this.collection = db.collection<MongoDeviceDoc>(MONGO_COLLECTIONS.DEVICES);
  }

  async create(input: CreateDeviceInput): Promise<Device> {
    const doc: MongoDeviceDoc = {
      _id: input.id,
      userId: input.userId,
      deviceToken: input.deviceToken,
      claimCode: input.claimCode ?? null,
      name: input.name ?? null,
      lastSeenAt: null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };

    await this.collection.insertOne(doc);
    return toDeviceDomain(doc);
  }

  async findById(id: string): Promise<Device | null> {
    const doc = await this.collection.findOne({ _id: id });
    return doc ? toDeviceDomain(doc) : null;
  }

  async findByToken(deviceToken: string): Promise<Device | null> {
    const doc = await this.collection.findOne({ deviceToken });
    return doc ? toDeviceDomain(doc) : null;
  }

  async findByUserId(userId: string): Promise<Device[]> {
    const docs = await this.collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map(toDeviceDomain);
  }

  async claimDevice(id: string, input: ClaimDeviceInput): Promise<boolean> {
    const res = await this.collection.updateOne(
      { _id: id },
      {
        $set: {
          userId: input.userId,
          deviceToken: input.deviceToken,
          claimCode: input.claimCode,
          name: input.name ?? null,
          createdAt: input.createdAt ?? new Date().toISOString(),
        },
      }
    );
    return res.matchedCount > 0;
  }

  async rotateToken(id: string, userId: string, newDeviceToken: string): Promise<boolean> {
    const res = await this.collection.updateOne(
      { _id: id, userId },
      { $set: { deviceToken: newDeviceToken } }
    );
    return res.matchedCount > 0;
  }

  async updateLastSeen(id: string, userId: string, lastSeenAt: string): Promise<void> {
    await this.collection.updateOne(
      { _id: id, userId },
      { $set: { lastSeenAt } }
    );
  }

  async deleteById(id: string, userId: string): Promise<boolean> {
    const res = await this.collection.deleteOne({ _id: id, userId });
    if (res.deletedCount === 0) {
      return false;
    }

    // SQLite ON DELETE SET NULL equivalent:
    // Update drink_records referencing this device to null
    await this.db
      .collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS)
      .updateMany({ deviceId: id }, { $set: { deviceId: null } });

    return true;
  }
}
