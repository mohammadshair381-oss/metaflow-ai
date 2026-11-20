import {
  archiveWorkspaceRequestSchema,
  createWorkspaceRequestSchema,
  recordIdSchema,
  updateWorkspaceRequestSchema,
  type WorkspaceListResponse,
  type WorkspaceMemberListResponse,
  type WorkspaceResponse,
} from '@metaflow/shared';
import type { RequestHandler, Response } from 'express';
import { z } from 'zod';
import {
  toWorkspace,
  toWorkspaceMember,
  type WorkspaceService,
} from '../services/workspace.service';
import { AppError } from '../utils/app-error';
import { parseRequest } from '../validators/parse-request';

export interface WorkspaceController {
  list: RequestHandler;
  create: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  archive: RequestHandler;
  listMembers: RequestHandler;
}

const workspaceParamsSchema = z.object({ workspaceId: recordIdSchema });

/**
 * HTTP adapter for the workspace service. The caller always comes from the verified session
 * (`res.locals.auth`); the workspace ID in the URL is only a lookup key that the service
 * checks against the caller's memberships.
 */
export function createWorkspaceController(service: WorkspaceService): WorkspaceController {
  const callerId = (res: Response) => {
    const auth = res.locals.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    return auth.user.id;
  };

  return {
    list: async (_req, res) => {
      const workspaces = await service.listForUser(callerId(res));
      const payload: WorkspaceListResponse = { workspaces: workspaces.map(toWorkspace) };
      res.status(200).json(payload);
    },

    create: async (req, res) => {
      const { body } = parseRequest(req, { body: createWorkspaceRequestSchema });
      const payload: WorkspaceResponse = {
        workspace: toWorkspace(await service.create(callerId(res), body)),
      };
      res.status(201).json(payload);
    },

    get: async (req, res) => {
      const { params } = parseRequest(req, { params: workspaceParamsSchema });
      const access = await service.requireAccess(callerId(res), params.workspaceId);
      const payload: WorkspaceResponse = { workspace: toWorkspace(access) };
      res.status(200).json(payload);
    },

    update: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParamsSchema,
        body: updateWorkspaceRequestSchema,
      });
      const access = await service.update(callerId(res), params.workspaceId, body);
      const payload: WorkspaceResponse = { workspace: toWorkspace(access) };
      res.status(200).json(payload);
    },

    archive: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParamsSchema,
        body: archiveWorkspaceRequestSchema,
      });
      await service.archive(callerId(res), params.workspaceId, body.confirmName);
      res.status(204).end();
    },

    listMembers: async (req, res) => {
      const { params } = parseRequest(req, { params: workspaceParamsSchema });
      const members = await service.listMembers(callerId(res), params.workspaceId);
      const payload: WorkspaceMemberListResponse = { members: members.map(toWorkspaceMember) };
      res.status(200).json(payload);
    },
  };
}
