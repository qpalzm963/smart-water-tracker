import { Collection, Db, MongoServerError } from 'mongodb';
import {
  IUserRepository,
  CreateUserInput,
  UpdateUserProfileInput,
} from '../interfaces';
import { User } from '../../types';
import {
  MONGO_COLLECTIONS,
  MongoUserDoc,
} from '../../database/mongoCollections';

export function toUserDomain(doc: MongoUserDoc): User {
  return {
    id: doc._id,
    username: doc.username,
    email: doc.email,
    password_hash: doc.passwordHash,
    display_name: doc.displayName,
    daily_goal_ml: doc.dailyGoalMl,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

export class MongoUserRepository implements IUserRepository {
  private collection: Collection<MongoUserDoc>;
  private db: Db;

  constructor(db: Db) {
    this.db = db;
    this.collection = db.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS);
  }

  async create(input: CreateUserInput): Promise<User> {
    const now = new Date().toISOString();
    const doc: MongoUserDoc = {
      _id: input.id,
      username: input.username,
      email: input.email,
      passwordHash: input.passwordHash,
      displayName: input.displayName ?? null,
      dailyGoalMl: input.dailyGoalMl ?? 2000,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      isDeleting: false,
    };

    try {
      await this.collection.insertOne(doc);
      return toUserDomain(doc);
    } catch (err: any) {
      if (err instanceof MongoServerError && err.code === 11000) {
        const keyPattern = err.keyPattern || {};
        if (keyPattern.email || (err.message && err.message.includes('idx_users_email'))) {
          const customError = new Error('Email is already registered');
          (customError as any).code = 'DUPLICATE_EMAIL';
          throw customError;
        }
        const customError = new Error('Username is already registered');
        (customError as any).code = 'DUPLICATE_USERNAME';
        throw customError;
      }
      throw err;
    }
  }

  async findById(id: string): Promise<User | null> {
    const doc = await this.collection.findOne({ _id: id, isDeleting: { $ne: true } });
    return doc ? toUserDomain(doc) : null;
  }

  async findByUsernameOrEmail(identifier: string): Promise<User | null> {
    const doc = await this.collection.findOne(
      {
        $or: [{ username: identifier }, { email: identifier }],
        isDeleting: { $ne: true },
      },
      {
        collation: { locale: 'en', strength: 2 },
      }
    );
    return doc ? toUserDomain(doc) : null;
  }

  async updateProfile(id: string, input: UpdateUserProfileInput): Promise<User | null> {
    const updateDoc: Partial<MongoUserDoc> = {
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    if (input.displayName !== undefined) {
      updateDoc.displayName = input.displayName;
    }
    if (input.dailyGoalMl !== undefined) {
      updateDoc.dailyGoalMl = input.dailyGoalMl;
    }

    const res = await this.collection.findOneAndUpdate(
      { _id: id, isDeleting: { $ne: true } },
      { $set: updateDoc },
      { returnDocument: 'after' }
    );

    return res ? toUserDomain(res) : null;
  }

  async deleteById(id: string): Promise<boolean> {
    // Step 1: Mark user as deleting to immediately reject new concurrent child writes
    const marked = await this.collection.findOneAndUpdate(
      { _id: id, isDeleting: { $ne: true } },
      { $set: { isDeleting: true } }
    );
    const existing = marked || (await this.collection.findOne({ _id: id }));
    if (!existing) {
      return false;
    }

    // Step 2: Cascade deletion of dependent records FIRST before deleting the user.
    // Guarantees that any transient failure leaves the user intact (in deleting state) for retry.
    await Promise.all([
      this.db.collection(MONGO_COLLECTIONS.DEVICES).deleteMany({ userId: id }),
      this.db.collection(MONGO_COLLECTIONS.DRINK_RECORDS).deleteMany({ userId: id }),
      this.db.collection(MONGO_COLLECTIONS.DELETED_WATER_EVENTS).deleteMany({ userId: id }),
    ]);

    // Step 3: Delete user document
    const res = await this.collection.deleteOne({ _id: id });

    // Step 4: Post-delete compensating sweep to ensure no late-arriving concurrent request left orphan data
    await Promise.all([
      this.db.collection(MONGO_COLLECTIONS.DEVICES).deleteMany({ userId: id }),
      this.db.collection(MONGO_COLLECTIONS.DRINK_RECORDS).deleteMany({ userId: id }),
      this.db.collection(MONGO_COLLECTIONS.DELETED_WATER_EVENTS).deleteMany({ userId: id }),
    ]);

    return res.deletedCount > 0 || !!existing;
  }
}
