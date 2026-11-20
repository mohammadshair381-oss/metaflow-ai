import { Outlet } from 'react-router-dom';
import { WorkspaceGate } from '@/components/workspaces/workspace-gate';
import { WorkspaceSwitcher } from '@/components/workspaces/workspace-switcher';
import { useAuth } from '@/contexts/auth-context';
import { WorkspaceProvider } from '@/contexts/workspace-provider';
import { Brand } from './brand';
import { MobileNav } from './mobile-nav';
import { SidebarNav } from './sidebar-nav';
import { UserMenu } from './user-menu';

/**
 * Shell for every signed-in page: sidebar on large screens, drawer navigation on small ones.
 * Loads the user's workspaces; pages render only once one is active.
 */
export function DashboardLayout() {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null; // ProtectedRoute guarantees a user here.

  return (
    // Keyed by user so one account's workspaces can never carry over to another.
    <WorkspaceProvider key={state.user.id} userId={state.user.id}>
      <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
        <aside className="bg-sidebar sticky top-0 hidden h-dvh flex-col border-r lg:flex">
          <div className="flex h-16 shrink-0 items-center px-5">
            <Brand to="/dashboard" />
          </div>
          <div className="flex-1 overflow-y-auto px-3 pt-2 pb-6">
            <SidebarNav />
          </div>
          <div className="text-muted-foreground border-t px-5 py-4 text-xs">
            AI Studio milestone · v0.1
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="bg-background/85 sticky top-0 z-20 flex h-16 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
            <MobileNav />
            <div className="lg:hidden">
              <Brand to="/dashboard" />
            </div>
            <WorkspaceSwitcher />
            <div className="ml-auto flex items-center gap-3">
              <UserMenu />
            </div>
          </header>
          <main className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <WorkspaceGate>
              <Outlet />
            </WorkspaceGate>
          </main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
