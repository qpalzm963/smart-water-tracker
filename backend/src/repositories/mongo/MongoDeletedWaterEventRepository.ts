import { Collection, Db } from 'mongodb';
import { IDeletedWaterEventRepository } from '../interfaces';
import {
  MONGO_COLLECTIONS,
  MongoDeletedWaterEventDoc,
} from '../../database/mongoCollections';

export class MongoDeletedWaterEventRepository
  implements IDeletedWaterEventRepository
{
  private collection: Collection<MongoDeletedWaterEventDoc>;

  constructor(db: Db) {
    this.collection = db.collection<MongoDeletedWaterEventDoc>(
      MONGO_COLLECTIONS.DELETED_WATER_EVENTS
    );
  }

  async isEventDeleted(userId: string, eventId: string): Promise<boolean> {
    const count = await this.collection.countDocuments(
      { userId, eventId },
      { limit: 1 }
    );
    return count > 0;
  }

  async recordDeletedEvent(
    userId: string,
    eventId: string,
    deletedAt?: string
  ): Promise<void> {
    const id = `${userId}:${eventId}`;
    await this.collection.updateOne(
      { _id: id },
      {
        $setOnInsert: {
          _id: id,
          userId,
          eventId,
          deletedAt: deletedAt ?? new Date().toISOString(),
        },
      },
      { upsert: true }
    );
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.collection.deleteMany({ userId });
  }
}
