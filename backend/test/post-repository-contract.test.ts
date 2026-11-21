import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createDatabase } from '../src/config/database';
import { PostModel } from '../src/models/post.model';
import { createMongoPostRepository } from '../src/repositories/mongo-post-repository';
import type { PostRecord } from '../src/repositories/post-repositories';
import { silentLogger } from './helpers';
import { createInMemoryPostRepository } from './support/in-memory-post-repository';
import {
  newObjectId,
  POST_REPOSITORY_CONTRACT,
  type PostRepositoryTarget,
} from './support/post-repository-contract';

describe('post repository contract: in-memory', () => {
  const repository = createInMemoryPostRepository();
  const target: PostRepositoryTarget = {
    repository,
    insertLegacyDraft: (workspaceId, createdBy) => {
      const at = new Date();
      const legacy: Partial<PostRecord> = {
        id: newObjectId(),
        workspaceId,
        status: 'draft',
        title: '',
        caption: 'Legacy',
        hashtags: [],
        platforms: [],
        mediaIds: [],
        socialAccountIds: [],
        source: 'manual',
        generationId: null,
        reviewEvents: [],
        scheduledAt: null,
        createdBy,
        updatedBy: createdBy,
        createdAt: at,
        updatedAt: at,
      };
      // No `revision`: stored exactly like a post saved before the field existed.
      repository.store.posts.push(legacy as PostRecord);
      return Promise.resolve(legacy.id as string);
    },
  };
  for (const { name, run } of POST_REPOSITORY_CONTRACT) it(name, () => run(target));
});

/**
 * The same cases against a real MongoDB. Runs only when MONGODB_TEST_URI is set and its
 * database name contains "test" (use metaflow_test). Removes exactly the posts it created.
 */
const testUri = process.env.MONGODB_TEST_URI;

describe.runIf(testUri)('post repository contract: MongoDB (MONGODB_TEST_URI)', () => {
  const database = createDatabase({ uri: testUri, logger: silentLogger, autoIndex: false });
  const workspaceIds = new Set<string>();
  const repository = createMongoPostRepository();
  const tracked: PostRepositoryTarget = {
    repository: {
      ...repository,
      create: async (post) => {
        workspaceIds.add(post.workspaceId);
        return repository.create(post);
      },
    },
    insertLegacyDraft: async (workspaceId, createdBy) => {
      workspaceIds.add(workspaceId);
      const owner = new mongoose.Types.ObjectId(createdBy);
      const { insertedId } = await PostModel.collection.insertOne({
        workspaceId: new mongoose.Types.ObjectId(workspaceId),
        status: 'draft',
        caption: 'Legacy',
        hashtags: [],
        platforms: [],
        source: 'manual',
        generationId: null,
        createdBy: owner,
        updatedBy: owner,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return insertedId.toString();
    },
  };

  beforeAll(async () => {
    await database.connect();
    const name = mongoose.connection.name;
    if (!/test/i.test(name)) {
      await database.disconnect();
      throw new Error(`Refusing to run: database "${name}" does not look like a test database`);
    }
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === mongoose.ConnectionStates.connected) {
      await PostModel.deleteMany({
        workspaceId: { $in: [...workspaceIds].map((id) => new mongoose.Types.ObjectId(id)) },
      });
    }
    await database.disconnect();
  });

  for (const { name, run } of POST_REPOSITORY_CONTRACT) it(name, () => run(tracked));
});
