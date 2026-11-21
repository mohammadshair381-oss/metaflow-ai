import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { FullPageSpinner } from '@/components/common/full-page-spinner';
import { RootLayout } from '@/components/layout/root-layout';
import { LandingPage } from '@/pages/landing-page';
import { LoginPage } from '@/pages/login-page';
import { NotFoundPage } from '@/pages/not-found-page';
import { RegisterPage } from '@/pages/register-page';
import { RouteErrorPage } from '@/pages/route-error-page';
import { GuestRoute } from './guest-route';
import { PLANNED_MODULES } from './navigation';
import { ProtectedRoute } from './protected-route';

/**
 * Route table. Exported separately from the router so tests can mount it in a memory router.
 *
 * Public pages are in the main bundle. The signed-in area (layout, dashboard, modules) is
 * code-split with `lazy`, so visitors to the landing page don't download it.
 *
 * Deep links work because every unknown path is served index.html (Vite dev/preview by
 * default, Vercel via the rewrite in vercel.json) and resolved here.
 */
export const appRoutes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <FullPageSpinner label="Loading…" />,
    children: [
      { path: '/', element: <LandingPage /> },
      {
        element: <GuestRoute />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
        ],
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            lazy: async () => {
              const { DashboardLayout } = await import('@/components/layout/dashboard-layout');
              return { Component: DashboardLayout };
            },
            children: [
              {
                path: '/dashboard',
                lazy: async () => {
                  const { DashboardPage } = await import('@/pages/dashboard-page');
                  return { Component: DashboardPage };
                },
              },
              {
                path: '/workspaces/new',
                lazy: async () => {
                  const { WorkspaceNewPage } = await import('@/pages/workspace-new-page');
                  return { Component: WorkspaceNewPage };
                },
              },
              {
                path: '/ai-studio',
                lazy: async () => {
                  const { AiStudioPage } = await import('@/pages/ai-studio-page');
                  return { Component: AiStudioPage };
                },
              },
              {
                path: '/posts',
                lazy: async () => {
                  const { PostsPage } = await import('@/pages/posts-page');
                  return { Component: PostsPage };
                },
              },
              {
                path: '/posts/new',
                lazy: async () => {
                  const { PostEditorPage } = await import('@/pages/post-editor-page');
                  return { Component: PostEditorPage };
                },
              },
              {
                path: '/posts/:postId',
                lazy: async () => {
                  const { PostEditorPage } = await import('@/pages/post-editor-page');
                  return { Component: PostEditorPage };
                },
              },
              {
                path: '/media',
                lazy: async () => {
                  const { MediaLibraryPage } = await import('@/pages/media-library-page');
                  return { Component: MediaLibraryPage };
                },
              },
              {
                path: '/accounts',
                lazy: async () => {
                  const { SocialAccountsPage } = await import('@/pages/social-accounts-page');
                  return { Component: SocialAccountsPage };
                },
              },
              {
                path: '/settings',
                lazy: async () => {
                  const { WorkspaceSettingsPage } = await import('@/pages/workspace-settings-page');
                  return { Component: WorkspaceSettingsPage };
                },
              },
              ...PLANNED_MODULES.map((module): RouteObject => ({
                path: module.path,
                lazy: async () => {
                  const { ModulePage } = await import('@/pages/module-page');
                  return { element: <ModulePage module={module} /> };
                },
              })),
            ],
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
