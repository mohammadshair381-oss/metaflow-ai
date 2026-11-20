// @vitest-environment jsdom
import type {
  AiGeneration,
  AiGenerationUsage,
  BrandVoice,
  CaptionGeneration,
  Workspace,
} from '@metaflow/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/auth-provider';
import { appRoutes } from '@/routes/router';
import {
  TEST_USER,
  TEST_WORKSPACE,
  apiError,
  json,
  jsonBodyOf,
  mockApi,
  urlOf,
} from '@/test/auth-test-utils';

const BASE = `/api/workspaces/${TEST_WORKSPACE.id}`;
const VOICE: BrandVoice = {
  description: 'Sourdough and pastries.',
  language: 'en',
  targetAudience: '',
  tone: 'conversational',
  personality: '',
  writingStyle: '',
  wordsToUse: [],
  wordsToAvoid: [],
  emojiPreference: 'none',
  additionalInstructions: '',
  configured: true,
  updatedAt: '2026-11-20T10:00:00.000Z',
};
const USAGE: AiGenerationUsage = {
  provider: 'anthropic',
  model: 'claude-opus-5-5',
  inputTokens: 900,
  outputTokens: 300,
  totalTokens: 1200,
  estimatedCostUsd: null,
};
let ids = 0;
const nextId = () => (ids += 1).toString(16).padStart(24, 'a');

function captionGeneration(texts: string[]): CaptionGeneration {
  return {
    id: nextId(),
    userId: TEST_USER.id,
    createdAt: '2026-11-20T10:00:00.000Z',
    usage: USAGE,
    feature: 'caption',
    settings: {
      topic: 'Croissants',
      product: '',
      audience: '',
      platform: 'instagram',
      objective: 'engagement',
      tone: 'conversational',
      language: 'en',
      length: 'medium',
      emoji: 'none',
      callToAction: 'soft',
      callToActionText: '',
      variations: texts.length,
    },
    output: { captions: texts.map((text) => ({ text })) },
  };
}

const status = (configured = true) => ({
  [`GET ${BASE}/ai/status`]: () =>
    json({
      configured,
      provider: configured ? 'anthropic' : null,
      model: configured ? 'claude-opus-5-5' : null,
      costEstimates: false,
    }),
  [`GET ${BASE}/ai/brand-voice`]: () => json({ brandVoice: VOICE }),
});

function renderApp(routes: Parameters<typeof mockApi>[0], path = '/ai-studio') {
  const fetchMock = mockApi({
    'GET /api/auth/me': () => json({ user: TEST_USER }),
    ...status(),
    ...routes,
  });
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
  const callsTo = (method: string, pathname: string) =>
    fetchMock.mock.calls.filter(
      ([url, init]) =>
        new URL(urlOf(url), 'http://localhost').pathname === pathname &&
        (init?.method ?? 'GET') === method,
    );
  return { router, callsTo };
}

const captionsPanel = async () => within(await screen.findByRole('tabpanel', { name: 'Captions' }));
/** Fills in the topic in the (visible) Captions panel. */
async function describePost(topic = 'Croissants') {
  const panel = await captionsPanel();
  fireEvent.change(panel.getByLabelText('What is the post about?'), { target: { value: topic } });
  return panel;
}
const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole('tab', { name }));
const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  window.localStorage.clear();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('AI Studio: setup', () => {
  it('explains that AI is not set up and turns generation off, but keeps the brand voice usable', async () => {
    renderApp(status(false));
    expect(await screen.findByText(/AI generation is not set up on this server yet/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate captions' })).toBeDisabled();

    openTab('Brand voice');
    expect(await screen.findByRole('button', { name: 'Save brand voice' })).toBeEnabled();
  });

  it('offers a retry when AI Studio cannot load', async () => {
    let attempts = 0;
    renderApp({
      [`GET ${BASE}/ai/status`]: () => {
        attempts += 1;
        return attempts === 1
          ? apiError(503, 'SERVICE_UNAVAILABLE', 'Try again shortly')
          : json({ configured: true, provider: 'anthropic', model: 'm', costEstimates: false });
      },
    });
    expect(await screen.findByText(/could not load AI Studio/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Generate captions' })).toBeEnabled();
  });
});

describe('caption generator', () => {
  it('validates in the browser before calling the AI', async () => {
    const { callsTo } = renderApp({});
    fireEvent.click(await screen.findByRole('button', { name: 'Generate captions' }));
    expect(await screen.findByText('Describe what the post is about')).toBeVisible();
    expect(callsTo('POST', `${BASE}/ai/captions`)).toHaveLength(0);
  });

  it('shows a loading state, then editable captions with usage, using brand voice defaults', async () => {
    let finish: (response: Response) => void = () => {};
    const { callsTo } = renderApp({
      [`POST ${BASE}/ai/captions`]: () => new Promise<Response>((resolve) => (finish = resolve)),
    });
    await describePost();
    fireEvent.click(screen.getByRole('button', { name: 'Generate captions' }));

    expect(await screen.findByRole('button', { name: /Writing captions/ })).toBeDisabled();
    expect(screen.getByText('This can take up to a minute.')).toBeVisible();
    finish(json({ generation: captionGeneration(['Golden and flaky.', 'Weekend treat.']) }, 201));

    expect(await screen.findByLabelText('Caption 1')).toHaveValue('Golden and flaky.');
    expect(screen.getByLabelText('Caption 2')).toHaveValue('Weekend treat.');
    expect(screen.getByText('Anthropic Claude · claude-opus-5-5 · 1,200 tokens')).toBeVisible();
    expect(jsonBodyOf(callsTo('POST', `${BASE}/ai/captions`)[0]?.[1])).toMatchObject({
      topic: 'Croissants',
      platform: 'instagram',
      tone: 'conversational',
      emoji: 'none',
      language: 'en',
      variations: 3,
    });
  });

  it('copies and saves the edited caption as a draft', async () => {
    const generation = captionGeneration(['Golden and flaky.']);
    const { callsTo } = renderApp({
      [`POST ${BASE}/ai/captions`]: () => json({ generation }, 201),
      [`POST ${BASE}/posts`]: (init) =>
        json(
          {
            post: {
              id: 'f'.repeat(24),
              status: 'draft',
              caption: jsonBodyOf(init).caption,
              hashtags: [],
              platforms: ['instagram'],
              source: 'ai_studio',
              generationId: generation.id,
              createdBy: TEST_USER.id,
              createdAt: '2026-11-20T10:00:00.000Z',
              updatedAt: '2026-11-20T10:00:00.000Z',
            },
          },
          201,
        ),
    });
    await describePost();
    fireEvent.click(screen.getByRole('button', { name: 'Generate captions' }));
    const caption = await screen.findByLabelText('Caption 1');
    fireEvent.change(caption, { target: { value: 'Golden, flaky and warm.' } });

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Golden, flaky and warm.'));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));
    expect(await screen.findByText(/Saved as a draft/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'View drafts' })).toHaveAttribute('href', '/posts');
    expect(jsonBodyOf(callsTo('POST', `${BASE}/posts`)[0]?.[1])).toEqual({
      caption: 'Golden, flaky and warm.',
      platforms: ['instagram'],
      hashtags: [],
      generationId: generation.id,
    });
  });

  it('says so when copying is blocked', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    renderApp({
      [`POST ${BASE}/ai/captions`]: () => json({ generation: captionGeneration(['A']) }, 201),
    });
    await describePost();
    fireEvent.click(screen.getByRole('button', { name: 'Generate captions' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(await screen.findByText(/Copying is blocked in this browser/)).toBeVisible();
  });

  it('blocks saving a caption that is too long for the platform', async () => {
    renderApp({
      [`POST ${BASE}/ai/captions`]: () => json({ generation: captionGeneration(['Short']) }, 201),
    });
    await describePost();
    fireEvent.click(screen.getByRole('button', { name: 'Generate captions' }));
    fireEvent.change(await screen.findByLabelText('Caption 1'), {
      target: { value: 'x'.repeat(2201) },
    });

    expect(screen.getByText(/2201 \/ 2200 characters — too long for Instagram/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save as draft' })).toBeDisabled();
  });

  it('regenerates, and adds another variation that differs from those shown', async () => {
    const replies = [['First', 'Second'], ['Fresh one', 'Fresh two'], ['Third take']];
    const { callsTo } = renderApp({
      [`POST ${BASE}/ai/captions`]: () =>
        json({ generation: captionGeneration(replies.shift() ?? []) }, 201),
    });
    await describePost();
    fireEvent.click(screen.getByRole('button', { name: 'Generate captions' }));
    expect(await screen.findByLabelText('Caption 2')).toHaveValue('Second');

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(screen.getByLabelText('Caption 1')).toHaveValue('Fresh one'));

    fireEvent.click(screen.getByRole('button', { name: 'Another variation' }));
    expect(await screen.findByLabelText('Caption 3')).toHaveValue('Third take');
    const calls = callsTo('POST', `${BASE}/ai/captions`);
    expect(jsonBodyOf(calls[2]?.[1])).toMatchObject({
      variations: 1,
      avoid: ['Fresh one', 'Fresh two'],
    });
  });

  it.each([
    [
      422,
      'GENERATION_REFUSED',
      'The AI declined to write this. Try describing the post differently.',
    ],
    [502, 'INTEGRATION_ERROR', 'AI generation is not working because of a server setup problem.'],
    [429, 'RATE_LIMITED', 'Too many attempts. Wait a few minutes and try again.'],
  ])('shows the server’s explanation for HTTP %s', async (statusCode, code, message) => {
    renderApp({ [`POST ${BASE}/ai/captions`]: () => apiError(statusCode, code, message) });
    await describePost();
    fireEvent.click(screen.getByRole('button', { name: 'Generate captions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('button', { name: 'Generate captions' })).toBeEnabled();
  });
});

describe('hashtag generator', () => {
  it('groups suggestions, lets the user pick, and copies the selection', async () => {
    renderApp(
      {
        [`POST ${BASE}/ai/hashtags`]: () =>
          json(
            {
              generation: {
                id: nextId(),
                userId: TEST_USER.id,
                createdAt: '2026-11-20T10:00:00.000Z',
                usage: USAGE,
                feature: 'hashtags',
                settings: {
                  topic: 'Croissants',
                  product: '',
                  audience: '',
                  category: 'restaurant',
                  platform: 'instagram',
                  language: 'en',
                },
                output: {
                  broad: ['Food'],
                  niche: ['LahoreEats'],
                  industry: ['Bakery'],
                  product: [],
                },
              },
            },
            201,
          ),
      },
      '/ai-studio?tab=hashtags',
    );
    const panel = within(await screen.findByRole('tabpanel', { name: 'Hashtags' }));
    fireEvent.change(panel.getByLabelText('What is the post about?'), {
      target: { value: 'Croissants' },
    });
    fireEvent.click(panel.getByRole('button', { name: 'Suggest hashtags' }));

    expect(await panel.findByText('Broad')).toBeVisible();
    expect(panel.queryByText('Product-specific')).toBeNull();
    fireEvent.click(panel.getByLabelText('#LahoreEats'));
    fireEvent.click(panel.getByRole('button', { name: 'Copy selected (2)' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('#Food #Bakery'));
    expect(panel.getByText(/don’t guarantee more reach/)).toBeVisible();
  });
});

describe('content ideas', () => {
  it('turns an idea into a prefilled caption request', async () => {
    renderApp(
      {
        [`POST ${BASE}/ai/ideas`]: () =>
          json(
            {
              generation: {
                id: nextId(),
                userId: TEST_USER.id,
                createdAt: '2026-11-20T10:00:00.000Z',
                usage: USAGE,
                feature: 'ideas',
                settings: { focus: '', platform: null, types: [], count: 6, language: 'en' },
                output: {
                  ideas: [
                    {
                      title: 'Meet the bakers',
                      description: 'A video of the 5 a.m. bake.',
                      type: 'behind_the_scenes',
                      format: 'reel',
                      platform: 'facebook',
                      angle: 'The craft behind every loaf.',
                      callToAction: 'Visit us this Sunday',
                    },
                  ],
                },
              },
            },
            201,
          ),
      },
      '/ai-studio?tab=ideas',
    );
    const panel = within(await screen.findByRole('tabpanel', { name: 'Content ideas' }));
    fireEvent.click(panel.getByRole('button', { name: 'Get ideas' }));
    expect(await panel.findByText('Meet the bakers')).toBeVisible();
    expect(panel.getByText('Reel or short video · Facebook')).toBeVisible();

    fireEvent.click(panel.getByRole('button', { name: 'Write a caption' }));

    const captions = within(await screen.findByRole('tabpanel', { name: 'Captions' }));
    expect(captions.getByLabelText('What is the post about?')).toHaveValue(
      'Meet the bakers: A video of the 5 a.m. bake.',
    );
    expect(captions.getByLabelText('Platform')).toHaveValue('facebook');
    expect(captions.getByLabelText('Goal')).toHaveValue('brand_awareness');
    expect(captions.getByLabelText('What should readers do?')).toHaveValue('Visit us this Sunday');
  });
});

describe('brand voice', () => {
  it('lets the owner save it, one phrase per line', async () => {
    const { callsTo } = renderApp(
      {
        [`PUT ${BASE}/ai/brand-voice`]: (init) =>
          json({ brandVoice: { ...VOICE, ...jsonBodyOf(init), configured: true } }),
      },
      '/ai-studio?tab=brand-voice',
    );
    const panel = within(await screen.findByRole('tabpanel', { name: 'Brand voice' }));
    fireEvent.change(panel.getByLabelText('Words and phrases to use'), {
      target: { value: 'freshly baked\n\n  family recipe ' },
    });
    fireEvent.change(panel.getByLabelText('Target audience'), {
      target: { value: 'Young families' },
    });
    fireEvent.click(panel.getByRole('button', { name: 'Save brand voice' }));

    expect(await panel.findByText('Brand voice saved.')).toBeVisible();
    expect(jsonBodyOf(callsTo('PUT', `${BASE}/ai/brand-voice`)[0]?.[1])).toMatchObject({
      targetAudience: 'Young families',
      wordsToUse: ['freshly baked', 'family recipe'],
      tone: 'conversational',
      description: 'Sourdough and pastries.',
    });
  });

  it('shows staff the brand voice read-only', async () => {
    renderApp(
      { 'GET /api/workspaces': () => json({ workspaces: [{ ...TEST_WORKSPACE, role: 'staff' }] }) },
      '/ai-studio?tab=brand-voice',
    );
    const panel = within(await screen.findByRole('tabpanel', { name: 'Brand voice' }));
    expect(panel.getByText(/Only the workspace owner can change the brand voice/)).toBeVisible();
    expect(panel.queryByRole('button', { name: 'Save brand voice' })).toBeNull();
    expect(panel.getByLabelText('Target audience')).toBeDisabled();
  });
});

describe('history', () => {
  it('lists generations with this month’s usage and loads older ones', async () => {
    const first = captionGeneration(['Newest caption']);
    const older: AiGeneration = { ...captionGeneration(['Older caption']), userId: 'b'.repeat(24) };
    renderApp(
      {
        [`GET ${BASE}/ai/generations`]: () =>
          // The cursor is in the query; mockApi routes by path, so serve pages in order.
          json(pages.shift() ?? { generations: [], nextCursor: null }),
        [`GET ${BASE}/ai/usage`]: () =>
          json({
            usage: {
              periodStart: '2026-11-01T00:00:00.000Z',
              periodEnd: '2026-12-01T00:00:00.000Z',
              requests: 5,
              succeeded: 4,
              failed: 1,
              inputTokens: 4000,
              outputTokens: 2000,
              totalTokens: 6000,
              requestsWithoutTokenData: 1,
              estimatedCostUsd: null,
              requestsWithoutCost: 5,
            },
          }),
      },
      '/ai-studio?tab=history',
    );
    const pages = [
      { generations: [first], nextCursor: first.id },
      { generations: [older], nextCursor: null },
    ];
    const panel = within(await screen.findByRole('tabpanel', { name: 'History' }));
    expect(await panel.findByText('Newest caption')).toBeVisible();
    expect(panel.getByText('5 (1 failed)')).toBeVisible();
    expect(panel.getByText('6,000 · not reported for 1')).toBeVisible();
    expect(panel.getByText('Not available')).toBeVisible();
    expect(panel.getByText(/by you/)).toBeVisible();

    fireEvent.click(panel.getByRole('button', { name: 'Load older generations' }));
    expect(await panel.findByText('Older caption')).toBeVisible();
    expect(panel.getByText(/by a teammate/)).toBeVisible();
    expect(panel.queryByRole('button', { name: 'Load older generations' })).toBeNull();
  });
});

describe('switching workspaces', () => {
  it('loads the other workspace’s brand voice and clears the previous results', async () => {
    const second: Workspace = {
      ...TEST_WORKSPACE,
      id: '65f0c0ffee00000000002222',
      name: 'Loom Studio',
    };
    const secondBase = `/api/workspaces/${second.id}`;
    renderApp({
      'GET /api/workspaces': () => json({ workspaces: [TEST_WORKSPACE, second] }),
      [`POST ${BASE}/ai/captions`]: () =>
        json({ generation: captionGeneration(['Bloom caption']) }, 201),
      [`GET ${secondBase}/ai/status`]: () =>
        json({ configured: true, provider: 'anthropic', model: 'm', costEstimates: false }),
      [`GET ${secondBase}/ai/brand-voice`]: () =>
        json({ brandVoice: { ...VOICE, tone: 'luxury', emojiPreference: 'many' } }),
    });
    await describePost();
    fireEvent.click(screen.getByRole('button', { name: 'Generate captions' }));
    expect(await screen.findByLabelText('Caption 1')).toHaveValue('Bloom caption');

    fireEvent.change(screen.getByLabelText('Workspace'), { target: { value: second.id } });

    await waitFor(async () =>
      expect((await captionsPanel()).getByLabelText('Tone')).toHaveValue('luxury'),
    );
    expect(screen.queryByLabelText('Caption 1')).toBeNull();
    expect((await captionsPanel()).getByLabelText('What is the post about?')).toHaveValue('');
  });
});
