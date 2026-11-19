import { MilestoneCard } from '@/components/overview/milestone-card';
import { SystemStatusPanel } from '@/components/system-status/system-status-panel';

export default function OverviewPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:gap-8">
      <section className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Overview</h1>
        <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
          MetaFlow AI will connect your Facebook Pages and Instagram Professional accounts, draft
          posts with AI, and publish them on schedule. This first release verifies that the web app
          and the API are deployed and talking to each other.
        </p>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SystemStatusPanel />
        </div>
        <MilestoneCard />
      </div>
    </div>
  );
}
