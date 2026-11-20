import { PageHeader } from '@/components/common/page-header';
import { MilestoneCard } from '@/components/overview/milestone-card';
import { SystemStatusPanel } from '@/components/system-status/system-status-panel';
import { WorkspaceOverviewCard } from '@/components/workspaces/workspace-overview-card';
import { useDocumentTitle } from '@/hooks/use-document-title';

export function DashboardPage() {
  useDocumentTitle('Dashboard');

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:gap-8">
      <PageHeader
        title="Dashboard"
        description="Your workspace at a glance. Social accounts, AI content and publishing arrive in the next milestones."
      />

      <WorkspaceOverviewCard />

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SystemStatusPanel />
        </div>
        <MilestoneCard />
      </div>
    </div>
  );
}
