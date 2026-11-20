/**
 * Creates the MongoDB indexes declared on the models, deliberately (production never builds
 * indexes automatically; see docs/architecture.md, "Database").
 *
 *   pnpm --filter @metaflow/backend db:indexes            # dry run: list present / missing
 *   pnpm --filter @metaflow/backend db:indexes --apply    # create the missing ones
 *
 * Uses Model.createIndexes() (additive). Never syncIndexes(), which drops undeclared indexes.
 * Connects to MONGODB_URI (backend/.env outside production) and prints only the database name.
 */
import { existsSync } from 'node:fs';
import mongoose, { type Model } from 'mongoose';
import { createDatabase } from '../src/config/database';
import { EnvValidationError, parseEnv } from '../src/config/env';
import { SessionModel } from '../src/models/session.model';
import { UserModel } from '../src/models/user.model';
import { createLogger } from '../src/utils/logger';
import { planIndexes, type ExistingIndex } from './index-plan';

const MODELS: Model<never>[] = [UserModel, SessionModel] as unknown as Model<never>[];
const out = (line: string) => process.stdout.write(`${line}\n`);

async function existingIndexes(model: Model<never>): Promise<ExistingIndex[]> {
  try {
    return (await model.collection.listIndexes().toArray()) as ExistingIndex[];
  } catch (error) {
    // The collection does not exist yet: it has no indexes.
    if ((error as { codeName?: string }).codeName === 'NamespaceNotFound') return [];
    throw error;
  }
}

async function main(): Promise<number> {
  const apply = process.argv.includes('--apply');
  if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');

  let uri: string | undefined;
  try {
    uri = parseEnv(process.env).MONGODB_URI;
  } catch (error) {
    if (error instanceof EnvValidationError) {
      out(error.message);
      return 1;
    }
    throw error;
  }
  if (!uri) {
    out('MONGODB_URI is not set.');
    return 1;
  }

  const database = createDatabase({
    uri,
    logger: createLogger({ level: 'error' }),
    autoIndex: false,
  });
  await database.connect();
  try {
    out(
      `Database: ${mongoose.connection.name}${apply ? '' : '  (dry run; add --apply to create)'}`,
    );
    let missingTotal = 0;
    for (const model of MODELS) {
      const plan = planIndexes(model.schema.indexes(), await existingIndexes(model));
      missingTotal += plan.missing.length;
      out(
        `  ${model.collection.collectionName}: present [${plan.present.join(', ')}] missing [${plan.missing.join(', ')}]`,
      );
      if (apply && plan.missing.length > 0) {
        await model.createIndexes();
        out(`    created: ${plan.missing.join(', ')}`);
      }
    }
    if (!apply && missingTotal > 0)
      out(`${missingTotal} index(es) missing. Re-run with --apply to create them.`);
    if (missingTotal === 0) out('All declared indexes are present.');
    return 0;
  } finally {
    await database.disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    out(`Failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    process.exit(1);
  },
);
