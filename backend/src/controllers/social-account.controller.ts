import {
  connectSocialAccountRequestSchema,
  recordIdSchema,
  type ConnectSocialAccountResponse,
  type SocialAccountListResponse,
  type SocialAccountResponse,
} from '@metaflow/shared';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { toSocialAccount, type SocialAccountService } from '../services/social-account.service';
import { AppError } from '../utils/app-error';
import { parseRequest } from '../validators/parse-request';

export interface SocialAccountController {
  list: RequestHandler;
  get: RequestHandler;
  connect: RequestHandler;
  refresh: RequestHandler;
  disconnect: RequestHandler;
  metaCallback: RequestHandler;
}

const workspaceParams = z.object({ workspaceId: recordIdSchema });
const accountParams = workspaceParams.extend({ accountId: recordIdSchema });

/** Callback parameters are read leniently: a bad value becomes "missing", never a 400 page. */
const callbackText = z.string().max(2048).optional().catch(undefined);
const callbackQuery = z.object({ state: callbackText, code: callbackText, error: callbackText });

export function createSocialAccountController({
  service,
  /** The user behind the request's session cookie, if any. */
  sessionUserId,
  /** The web app's origin. The callback only ever redirects here. */
  appOrigin,
}: {
  service: SocialAccountService;
  sessionUserId: (req: Request) => Promise<string | null>;
  appOrigin: string;
}): SocialAccountController {
  const callerId = (res: Response) => {
    const auth = res.locals.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    return auth.user.id;
  };

  return {
    list: async (req, res) => {
      const { params } = parseRequest(req, { params: workspaceParams });
      const accounts = await service.list(callerId(res), params.workspaceId);
      const payload: SocialAccountListResponse = {
        accounts: accounts.map(toSocialAccount),
        integration: { configured: service.configured },
      };
      res.status(200).json(payload);
    },

    get: async (req, res) => {
      const { params } = parseRequest(req, { params: accountParams });
      const account = await service.get(callerId(res), params.workspaceId, params.accountId);
      const payload: SocialAccountResponse = { account: toSocialAccount(account) };
      res.status(200).json(payload);
    },

    connect: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParams,
        body: connectSocialAccountRequestSchema,
      });
      const payload: ConnectSocialAccountResponse = {
        authorizationUrl: await service.startConnection(
          callerId(res),
          params.workspaceId,
          body.platform,
        ),
      };
      res.status(200).json(payload);
    },

    refresh: async (req, res) => {
      const { params } = parseRequest(req, { params: accountParams });
      const account = await service.refresh(callerId(res), params.workspaceId, params.accountId);
      const payload: SocialAccountResponse = { account: toSocialAccount(account) };
      res.status(200).json(payload);
    },

    disconnect: async (req, res) => {
      const { params } = parseRequest(req, { params: accountParams });
      await service.disconnect(callerId(res), params.workspaceId, params.accountId);
      res.status(204).end();
    },

    /**
     * Meta redirects the browser here. It is a page navigation, so the answer is always a
     * redirect to the web app's Social Accounts page with a result code from a fixed list.
     * The destination is built from server configuration only.
     */
    metaCallback: async (req, res) => {
      const query = callbackQuery.parse(req.query);
      const outcome = await service.completeConnection({
        userId: await sessionUserId(req),
        state: query.state,
        code: query.code,
        error: query.error,
      });
      const destination = new URL('/accounts', appOrigin);
      destination.searchParams.set('meta', outcome.result);
      if (outcome.count > 0) destination.searchParams.set('count', String(outcome.count));
      res.set('Cache-Control', 'no-store');
      // The callback URL carries the authorization code: do not pass it on as a referrer.
      res.set('Referrer-Policy', 'no-referrer');
      res.redirect(303, destination.toString());
    },
  };
}
