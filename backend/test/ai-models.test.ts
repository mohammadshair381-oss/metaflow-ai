import { describe, expect, it } from 'vitest';
import { AiGenerationModel, AiUsageModel } from '../src/models/ai.model';
import { PostModel } from '../src/models/post.model';
import { WorkspaceModel } from '../src/models/workspace.model';

const ID = '65f0c0ffee0000000000abcd';

/** Schema-level checks; no database connection is opened. */
describe('AI generation and usage models', () => {
  const generation = {
    workspaceId: ID,
    userId: ID,
    feature: 'caption',
    settings: { topic: 'x' },
    output: { captions: [] },
    provider: 'anthropic',
    model: 'claude-opus-5-5',
  };

  it('stores token counts as unknown (null) by default, never zero', () => {
    const doc = new AiGenerationModel(generation);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.usage).toMatchObject({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: null,
    });
  });

  it('rejects unknown features and providers, and negative token counts', () => {
    expect(
      new AiGenerationModel({ ...generation, feature: 'poem' }).validateSync()?.errors.feature,
    ).toBeDefined();
    expect(
      new AiGenerationModel({ ...generation, provider: 'mistral' }).validateSync()?.errors.provider,
    ).toBeDefined();
    const usage = new AiUsageModel({
      workspaceId: ID,
      userId: ID,
      feature: 'ideas',
      provider: 'openai',
      model: 'm',
      status: 'succeeded',
      latencyMs: 10,
      inputTokens: -1,
    });
    expect(usage.validateSync()?.errors.inputTokens).toBeDefined();
  });

  it('has no field for prompts', () => {
    expect(AiGenerationModel.schema.path('prompt')).toBeUndefined();
    expect(AiGenerationModel.schema.path('system')).toBeUndefined();
    expect(AiUsageModel.schema.path('prompt')).toBeUndefined();
  });

  it('declares workspace-scoped indexes', () => {
    expect(AiGenerationModel.schema.indexes()).toContainEqual([
      { workspaceId: 1, _id: -1 },
      expect.anything(),
    ]);
    expect(AiUsageModel.schema.indexes()).toContainEqual([
      { workspaceId: 1, createdAt: -1 },
      expect.anything(),
    ]);
  });
});

describe('Post model', () => {
  const post = { workspaceId: ID, caption: 'Hello', createdBy: ID, updatedBy: ID };

  it('starts as a manual draft', () => {
    const doc = new PostModel(post);
    expect(doc.validateSync()).toBeUndefined();
    expect(doc).toMatchObject({ status: 'draft', source: 'manual', generationId: null });
  });

  it('rejects unknown statuses and platforms, and too many hashtags', () => {
    expect(new PostModel({ ...post, status: 'viral' }).validateSync()?.errors.status).toBeDefined();
    expect(
      new PostModel({ ...post, platforms: ['tiktok'] }).validateSync()?.errors['platforms.0'],
    ).toBeDefined();
    expect(
      new PostModel({
        ...post,
        hashtags: Array.from({ length: 31 }, (_, i) => `t${i}`),
      }).validateSync()?.errors.hashtags,
    ).toBeDefined();
  });
});

describe('Workspace brand voice', () => {
  const workspace = { name: 'Bloom', createdBy: ID };
  const voice = { tone: 'friendly', emojiPreference: 'few', updatedAt: new Date() };

  it('is null until saved, and validates when present', () => {
    expect(new WorkspaceModel(workspace).brandVoice).toBeNull();
    expect(new WorkspaceModel({ ...workspace, brandVoice: voice }).validateSync()).toBeUndefined();
    expect(
      new WorkspaceModel({ ...workspace, brandVoice: { ...voice, tone: 'grumpy' } }).validateSync()
        ?.errors['brandVoice.tone'],
    ).toBeDefined();
    expect(
      new WorkspaceModel({
        ...workspace,
        brandVoice: { ...voice, wordsToUse: Array.from({ length: 26 }, (_, i) => `w${i}`) },
      }).validateSync()?.errors['brandVoice.wordsToUse'],
    ).toBeDefined();
  });
});
