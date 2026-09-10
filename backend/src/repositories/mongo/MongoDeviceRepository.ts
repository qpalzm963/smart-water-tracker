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
  MongoUserDoc,
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
    // Verify parent user exists and is not being deleted
    const parentUser = await this.db.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS).findOne(
      { _id: input.userId, isDeleting: { $ne: true } },
      { projection: { _id: 1 } }
    );
    if (!parentUser) {
      const err: any = new Error('User does not exist or account is being deleted');
      err.code = 'USER_NOT_FOUND';
      throw err;
    }

    const doc: MongoDeviceDoc = {
      _id: input.id,
      userId: input.userId,
      deviceToken: input.deviceToken,
      claimCode: input.claimCode ?? null,
      name: input.name ?? null,
      lastSeenAt: null,
      createdAt: input.createdAt ?? new Date().toISOString(),
      isDeleting: false,
    };

    await this.collection.insertOne(doc);
    return toDeviceDomain(doc);
  }

  async findById(id: string): Promise<Device | null> {
    const doc = await this.collection.findOne({ _id: id, isDeleting: { $ne: true } });
    return doc ? toDeviceDomain(doc) : null;
  }

  async findByToken(deviceToken: string): Promise<Device | null> {
    const doc = await this.collection.findOne({ deviceToken, isDeleting: { $ne: true } });
    return doc ? toDeviceDomain(doc) : null;
  }

  async findByUserId(userId: string): Promise<Device[]> {
    const docs = await this.collection
      .find({ userId, isDeleting: { $ne: true } })
      .sort({ createdAt: -1 })
      .toArray();
    return docs.map(toDeviceDomain);
  }

  async claimDevice(id: string, input: ClaimDeviceInput): Promise<boolean> {
    const filter: Record<string, any> = { _id: id, isDeleting: { $ne: true } };
    if (input.expectedOwnerId !== undefined) {
      filter.userId = input.expectedOwnerId;
    }
    if (input.expectedClaimCode !== undefined) {
      filter.claimCode = input.expectedClaimCode;
    }

    const res = await this.collection.updateOne(
      filter,
      {
        $set: {
          userId: input.userId,
          deviceToken: input.deviceToken,
          claimCode: input.claimCode,
          name: input.name ?? null,
          createdAt: input.createdAt ?? new Date().toISOString(),
          isDeleting: false,
        },
      }
    );
    return res.matchedCount > 0;
  }

  async rotateToken(id: string, userId: string, newDeviceToken: string): Promise<boolean> {
    const res = await this.collection.updateOne(
      { _id: id, userId, isDeleting: { $ne: true } },
      { $set: { deviceToken: newDeviceToken } }
    );
    return res.matchedCount > 0;
  }

  async updateLastSeen(id: string, userId: string, lastSeenAt: string): Promise<void> {
    await this.collection.updateOne(
      { _id: id, userId, isDeleting: { $ne: true } },
      { $set: { lastSeenAt } }
    );
  }

  async deleteById(id: string, userId: string): Promise<boolean> {
    // Step 1: Atomically mark device as deleting to reject concurrent writes/auth
    const marked = await this.collection.findOneAndUpdate(
      { _id: id, userId, isDeleting: { $ne: true } },
      { $set: { isDeleting: true } }
    );
    const existing = marked || (await this.collection.findOne({ _id: id, userId }));
    if (!existing) {
      return false;
    }

    // Step 2: Nullify foreign references in drink_records FIRST before deleting device
    // Guarantees that failure leaves device in deleting state for safe retry
    await this.db
      .collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS)
      .updateMany({ deviceId: id }, { $set: { deviceId: null } });

    // Step 3: Delete device document only after child references are safely cleared
    const res = await this.collection.deleteOne({ _id: id, userId });

    // Step 4: Compensating cleanup sweep to prevent dangling reference from concurrent in-flight requests
    await this.db
      .collection<MongoDrinkRecordDoc>(MONGO_COLLECTIONS.DRINK_RECORDS)
      .updateMany({ deviceId: id }, { $set: { deviceId: null } });

    return res.deletedCount > 0 || !!existing;
  }
}
