# Setting up AI generation

AI Studio writes captions, suggests hashtags and proposes content ideas through one AI provider that the server is configured with. **It has been tested only with simulated provider responses.** It has not generated real content yet, because no provider API key is configured. This page lists what to configure and what to expect.

Until it is configured, the app works normally: AI Studio explains that generation is not set up and turns the generate buttons off, while brand voice, history and drafts still work.

## 1. Choose a provider and model

| `AI_PROVIDER` | API used                                     | Example `AI_MODEL`                               | Get a key                     |
| ------------- | -------------------------------------------- | ------------------------------------------------ | ----------------------------- |
| `anthropic`   | Claude Messages API, through Anthropic's SDK | `claude-opus-5-5`                                | <https://platform.claude.com> |
| `openai`      | OpenAI Responses API                         | a current model that supports Structured Outputs | <https://platform.openai.com> |
| `gemini`      | Google Gemini Interactions API               | a current Gemini model ID                        | <https://aistudio.google.com> |

The model must support structured (JSON-schema) output. Check the provider's model list for the exact ID; MetaFlow AI checks only its format.

Notes per provider:

- **Refusals are final, for every provider:** when the model or the provider's safety system declines a request, AI Studio tells the user and stops. The request is never retried and never sent to another model, and Anthropic's server-side refusal fallbacks are not used.
- **OpenAI:** requests are sent with `store: false`, so OpenAI does not keep them for later retrieval.
- **Gemini:** requests use the Interactions API (Google labels the older `generateContent` API legacy) with `store: false`.

## 2. Configure the backend

Add these to `backend/.env` locally (and to Render in production). Never commit them.

| Variable                       | Value                                          |
| ------------------------------ | ---------------------------------------------- |
| `AI_PROVIDER`                  | `anthropic`, `openai` or `gemini`              |
| `AI_MODEL`                     | The model ID                                   |
| `AI_API_KEY`                   | The provider's API key. Secret                 |
| `AI_PRICE_INPUT_PER_MTOK_USD`  | Optional: US dollars per million input tokens  |
| `AI_PRICE_OUTPUT_PER_MTOK_USD` | Optional: US dollars per million output tokens |

The first three are required together: with only some set, the backend refuses to start and names the missing variable. The two prices are optional, but both or neither; without them, no costs are estimated. Take them from the provider's current price list for the configured model.

Restart the backend. Its startup log shows `aiProvider` and `aiModel` (never the key).

## 3. Check it works

1. Sign in, open **AI Studio** and describe a post, then select **Generate captions**.
2. You should get captions within a minute, with a line naming the provider, model and tokens used.
3. Open **History**: the generation is listed, and **AI usage this month** counts it.

Please report anything that differs: the first real request is the first real test.

## What is sent and stored

- **Sent to the provider, per request:** the business name, category, description and time zone, the saved brand voice, and the form fields. Nothing else from the workspace, and no other workspace's data.
- **Stored by MetaFlow AI:** the form settings and the generated content (generation history, per workspace), and one usage record per request with provider, model, token counts, estimated cost, status and duration. Token counts and costs are stored as unknown when the provider does not report them, never as zero.
- **Never stored or logged:** the prompt text and the API key. Logs record only the kind of failure.

## Limits and safeguards

- **Who:** any workspace member can generate. Only the owner can change the brand voice.
- **Rate limit:** 30 generations per user per 10 minutes (429 `RATE_LIMITED`).
- **Timeouts and retries:** 60 seconds per attempt. One retry at most, and only after a fast failure the provider marks as not processed (overloaded, a server error, a dropped connection, or a rate limit with a short Retry-After). Timeouts are never retried, because the provider may still be producing, and billing, the first attempt.
- **Output checks:** every reply is validated before anyone sees it: caption lengths (Instagram 2,200 characters), hashtag format and count, idea types and platforms. Anything that fails is dropped; if nothing usable is left, the request fails with a clear message and its usage is still recorded.
- **Not built yet:** plan-based usage limits (billing milestone), admin-managed providers and per-plan model routing (super-admin milestone), AI image generation.
