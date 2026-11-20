import type {
  AiGenerationRecord,
  AiRepositories,
  AiUsageEntry,
} from '../../src/repositories/ai-repositories';

/** Increasing 24-hex IDs, so "newest first" and `before` cursors work as with ObjectIds. */
export function createIdSequence(start = 1) {
  let next = start;
  return () => (next++).toString(16).padStart(24, '0');
}

export interface InMemoryAiRepositories extends AiRepositories {
  store: { generations: AiGenerationRecord[]; usage: AiUsageEntry[] };
}

const copy = <T>(value: T): T => structuredClone(value);

/** Same contract as the MongoDB repositories: every read is scoped by workspace. */
export function createInMemoryAiRepositories(): InMemoryAiRepositories {
  const generations: AiGenerationRecord[] = [];
  const usage: AiUsageEntry[] = [];
  const nextId = createIdSequence();

  return {
    store: { generations, usage },

    generations: {
      create(generation) {
        const record = {
          ...copy(generation),
          id: nextId(),
          createdAt: new Date(),
        } as AiGenerationRecord;
        generations.push(record);
        return Promise.resolve(copy(record));
      },

      list(workspaceId, { feature, before, limit }) {
        return Promise.resolve(
          generations
            .filter((g) => g.workspaceId === workspaceId)
            .filter((g) => !feature || g.feature === feature)
            .filter((g) => !before || g.id < before)
            .sort((a, b) => (a.id < b.id ? 1 : -1))
            .slice(0, limit)
            .map(copy),
        );
      },

      findInWorkspace(workspaceId, generationId) {
        const found = generations.find(
          (g) => g.id === generationId && g.workspaceId === workspaceId,
        );
        return Promise.resolve(found ? copy(found) : null);
      },
    },

    usage: {
      record(entry) {
        usage.push(copy(entry));
        return Promise.resolve();
      },

      summarize(workspaceId, from, to) {
        const entries = usage.filter(
          (u) => u.workspaceId === workspaceId && u.createdAt >= from && u.createdAt < to,
        );
        const sum = (pick: (u: AiUsageEntry) => number | null) =>
          entries.reduce((total, u) => total + (pick(u) ?? 0), 0);
        const withCost = entries.filter((u) => u.estimatedCostUsd !== null);
        return Promise.resolve({
          requests: entries.length,
          succeeded: entries.filter((u) => u.status === 'succeeded').length,
          failed: entries.filter((u) => u.status === 'failed').length,
          inputTokens: sum((u) => u.inputTokens),
          outputTokens: sum((u) => u.outputTokens),
          totalTokens: sum((u) => u.totalTokens),
          requestsWithoutTokenData: entries.filter((u) => u.totalTokens === null).length,
          estimatedCostUsd: withCost.length > 0 ? sum((u) => u.estimatedCostUsd) : null,
          requestsWithoutCost: entries.length - withCost.length,
        });
      },
    },
  };
}
