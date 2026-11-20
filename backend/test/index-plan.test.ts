import { describe, expect, it } from 'vitest';
import { SessionModel } from '../src/models/session.model';
import { UserModel } from '../src/models/user.model';
import { planIndexes } from '../scripts/index-plan';

describe('index plan (db:indexes script)', () => {
  it('reports every declared index as missing on an empty database', () => {
    const plan = planIndexes(SessionModel.schema.indexes(), []);
    expect(plan.missing).toEqual([
      'sessions_token_hash_unique',
      'sessions_user_revoked',
      'sessions_expires_ttl',
    ]);
    expect(plan.present).toEqual([]);
  });

  it('matches existing indexes by key pattern, whatever their name', () => {
    const plan = planIndexes(UserModel.schema.indexes(), [
      { name: '_id_', key: { _id: 1 } },
      { name: 'email_1', key: { email: 1 } },
    ]);
    expect(plan).toEqual({ present: ['users_email_unique'], missing: [] });
  });

  it('never proposes dropping an index that exists but is not declared', () => {
    const plan = planIndexes([], [{ name: 'legacy_index', key: { legacy: 1 } }]);
    expect(plan).toEqual({ present: [], missing: [] });
  });
});
