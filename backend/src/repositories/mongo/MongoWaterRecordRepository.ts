import { Collection, Db, Filter, MongoServerError } from 'mongodb';
import {
  IWaterRecordRepository,
  CreateWaterRecordInput,
  QueryWaterRecordsInput,
} from '../interfaces';
import { DrinkRecord } from '../../types';
import {
  MONGO_COLLECTIONS,
  MongoDrinkRecordDoc,
} from '../../database/mongoCollections';

export function toDrinkRecordDomain(doc: MongoDrinkRecordDoc): DrinkRecord {
  return {
    id: doc._id,
    event_id: doc.eventId,
    user_id: doc.userId,
    device_id: doc.deviceId,
    event_type: doc.eventType,
    amount_ml: doc.amountMl,
    remaining_ml: doc.remainingMl,
    occurred_at: doc.occurredAt,
    synced_at: doc.syncedAt,
  };
}

export class MongoWaterRecordRepository implements IWaterRecordRepository {
  private collection: Collection<MongoDrinkRecordDoc>;

  constructor(db: Db) {
    this.collection = db.collection<MongoDrinkRecordDoc>(
      MONGO_COLLECTIONS.DRINK_RECORDS
    );
  }

  async create(
    input: CreateWaterRecordInput
  ): Promise<{ record: DrinkRecord; isDuplicate: boolean }> {
    const now = new Date().toISOString();
    const doc: MongoDrinkRecordDoc = {
      _id: input.id,
      eventId: input.eventId ?? null,
      userId: input.userId,
      deviceId: input.deviceId ?? null,
      eventType: input.eventType,
      amountMl: input.amountMl,
      remainingMl: input.remainingMl ?? null,
      occurredAt: input.occurredAt,
      timeSynced: input.timeSynced ?? true,
      syncedAt: input.syncedAt ?? now,
    };

    try {
      await this.collection.insertOne(doc);
      return { record: toDrinkRecordDomain(doc), isDuplicate: false };
    } catch (err: any) {
      if (
        input.eventId &&
        err instanceof MongoServerError &&
        err.code === 11000
      ) {
        // Idempotent deduplication: find existing record
        const existing = await this.collection.findOne({
          userId: input.userId,
          eventId: input.eventId,
        });
        if (existing) {
          return { record: toDrinkRecordDomain(existing), isDuplicate: true };
        }
      }
      throw err;
    }
  }

  async findById(id: string, userId: string): Promise<DrinkRecord | null> {
    const doc = await this.collection.findOne({ _id: id, userId });
    return doc ? toDrinkRecordDomain(doc) : null;
  }

  async findByUserAndEventId(
    userId: string,
    eventId: string
  ): Promise<DrinkRecord | null> {
    const doc = await this.collection.findOne({ userId, eventId });
    return doc ? toDrinkRecordDomain(doc) : null;
  }

  async list(
    input: QueryWaterRecordsInput
  ): Promise<{ records: DrinkRecord[]; total: number }> {
    const filter: Filter<MongoDrinkRecordDoc> = { userId: input.userId };

    if (input.fromDate || input.toDate) {
      filter.occurredAt = {};
      if (input.fromDate) {
        filter.occurredAt.$gte = input.fromDate;
      }
      if (input.toDate) {
        filter.occurredAt.$lte = input.toDate;
      }
    }

    if (input.eventType) {
      filter.eventType = input.eventType;
    }

    if (input.deviceId) {
      filter.deviceId = input.deviceId;
    }

    const total = await this.collection.countDocuments(filter);
    const offset = (input.page - 1) * input.limit;

    const docs = await this.collection
      .find(filter)
      .sort({ occurredAt: -1 })
      .skip(offset)
      .limit(input.limit)
      .toArray();

    return {
      records: docs.map(toDrinkRecordDomain),
      total,
    };
  }

  async deleteById(id: string, userId: string): Promise<boolean> {
    const res = await this.collection.deleteOne({ _id: id, userId });
    return res.deletedCount > 0;
  }

  async getRecordsInRange(
    userId: string,
    startIso: string,
    endIso: string
  ): Promise<Array<{ event_type: 'drink' | 'refill'; amount_ml: number; occurred_at: string }>> {
    const docs = await this.collection
      .find(
        {
          userId,
          occurredAt: { $gte: startIso, $lte: endIso },
        },
        {
          projection: {
            eventType: 1,
            amountMl: 1,
            occurredAt: 1,
          },
        }
      )
      .toArray();

    return docs.map((d) => ({
      event_type: d.eventType,
      amount_ml: d.amountMl,
      occurred_at: d.occurredAt,
    }));
  }

  async getDailyRecords(
    userId: string,
    startIso: string,
    endIso: string
  ): Promise<Array<{ event_type: 'drink' | 'refill'; amount_ml: number }>> {
    const docs = await this.collection
      .find(
        {
          userId,
          occurredAt: { $gte: startIso, $lte: endIso },
        },
        {
          sort: { occurredAt: 1 },
          projection: {
            eventType: 1,
            amountMl: 1,
          },
        }
      )
      .toArray();

    return docs.map((d) => ({
      event_type: d.eventType,
      amount_ml: d.amountMl,
    }));
  }
}
