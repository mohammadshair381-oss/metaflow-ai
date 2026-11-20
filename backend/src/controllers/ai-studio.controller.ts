import {
  aiGenerationListQuerySchema,
  captionRequestSchema,
  hashtagRequestSchema,
  ideasRequestSchema,
  recordIdSchema,
  updateBrandVoiceRequestSchema,
  type AiGenerationListResponse,
  type AiStatusResponse,
} from '@metaflow/shared';
import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import { toAiGeneration, type AiStudioService } from '../services/ai-studio.service';
import { AppError } from '../utils/app-error';
import { parseRequest } from '../validators/parse-request';

export interface AiStudioController {
  status: RequestHandler;
  captions: RequestHandler;
  hashtags: RequestHandler;
  ideas: RequestHandler;
  getBrandVoice: RequestHandler;
  updateBrandVoice: RequestHandler;
  generations: RequestHandler;
  usage: RequestHandler;
}

const workspaceParams = z.object({ workspaceId: recordIdSchema });

/**
 * HTTP adapter for AI Studio. The caller comes from the verified session; the workspace ID in
 * the URL is checked against the caller's memberships by the service. Request bodies are strict
 * (no provider, model or prompt fields).
 */
export function createAiStudioController(service: AiStudioService): AiStudioController {
  const callerId = (res: Response) => {
    const auth = res.locals.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    return auth.user.id;
  };

  return {
    status: async (req, res) => {
      const { params } = parseRequest(req, { params: workspaceParams });
      const payload: AiStatusResponse = await service.status(callerId(res), params.workspaceId);
      res.status(200).json(payload);
    },

    captions: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParams,
        body: captionRequestSchema,
      });
      const generation = await service.generateCaptions(callerId(res), params.workspaceId, body);
      res.status(201).json({ generation: toAiGeneration(generation) });
    },

    hashtags: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParams,
        body: hashtagRequestSchema,
      });
      const generation = await service.generateHashtags(callerId(res), params.workspaceId, body);
      res.status(201).json({ generation: toAiGeneration(generation) });
    },

    ideas: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParams,
        body: ideasRequestSchema,
      });
      const generation = await service.generateIdeas(callerId(res), params.workspaceId, body);
      res.status(201).json({ generation: toAiGeneration(generation) });
    },

    getBrandVoice: async (req, res) => {
      const { params } = parseRequest(req, { params: workspaceParams });
      const brandVoice = await service.getBrandVoice(callerId(res), params.workspaceId);
      res.status(200).json({ brandVoice });
    },

    updateBrandVoice: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParams,
        body: updateBrandVoiceRequestSchema,
      });
      const brandVoice = await service.updateBrandVoice(callerId(res), params.workspaceId, body);
      res.status(200).json({ brandVoice });
    },

    generations: async (req, res) => {
      const { params, query } = parseRequest(req, {
        params: workspaceParams,
        query: aiGenerationListQuerySchema,
      });
      const page = await service.listGenerations(callerId(res), params.workspaceId, query);
      const payload: AiGenerationListResponse = {
        generations: page.generations.map(toAiGeneration),
        nextCursor: page.nextCursor,
      };
      res.status(200).json(payload);
    },

    usage: async (req, res) => {
      const { params } = parseRequest(req, { params: workspaceParams });
      const usage = await service.usageSummary(callerId(res), params.workspaceId);
      res.status(200).json({ usage });
    },
  };
}
