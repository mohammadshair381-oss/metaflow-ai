import type { ReactNode } from 'react';
import { AppShell } from '@/components/layout/app-shell';

/** Signed-in product area. Sign-in pages will live outside this route group. */
export default function DashboardLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
