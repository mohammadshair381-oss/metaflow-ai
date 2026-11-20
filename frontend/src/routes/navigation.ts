import {
  CalendarDays,
  ChartColumn,
  CreditCard,
  FileText,
  LayoutDashboard,
  Palette,
  Settings,
  Share2,
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface PlannedModule {
  path: string;
  label: string;
  icon: LucideIcon;
  /** What the module will do once built. Shown on its empty-state page. */
  description: string;
  /** Roadmap milestone that delivers it (see README → Roadmap). */
  milestone: { number: number; name: string };
}

export interface NavigationItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** True for modules that only have an empty-state page so far. */
  planned: boolean;
}

export interface NavigationSection {
  title?: string;
  items: NavigationItem[];
}

const MILESTONES = {
  workspaces: { number: 3, name: 'Team invitations and role management' },
  meta: { number: 4, name: 'Facebook and Instagram connection' },
  aiInfrastructure: { number: 5, name: 'AI infrastructure and brand profiles' },
  content: { number: 6, name: 'AI Studio and content management' },
  publishing: { number: 7, name: 'Scheduling, approvals and publishing' },
  growth: { number: 8, name: 'Automation, analytics, billing and administration' },
} as const;

/** Modules that are routed but not built. Each renders an honest empty state. */
export const PLANNED_MODULES: PlannedModule[] = [
  {
    path: '/accounts',
    label: 'Social Accounts',
    icon: Share2,
    description:
      'Connect Facebook Pages and Instagram Professional accounts through Meta’s official login, and see which permissions each one has granted.',
    milestone: MILESTONES.meta,
  },
  {
    path: '/ai-studio',
    label: 'AI Studio',
    icon: Sparkles,
    description:
      'Generate captions and hashtags in your brand’s voice, compare variations and refine them before they become posts.',
    milestone: MILESTONES.content,
  },
  {
    path: '/calendar',
    label: 'Content Calendar',
    icon: CalendarDays,
    description:
      'See scheduled and published posts across every connected account on one calendar.',
    milestone: MILESTONES.publishing,
  },
  {
    path: '/posts',
    label: 'Posts',
    icon: FileText,
    description:
      'Draft, review and manage posts, with previews of how each one will look on Facebook and Instagram.',
    milestone: MILESTONES.content,
  },
  {
    path: '/automations',
    label: 'Automation Center',
    icon: Workflow,
    description:
      'Set up schedules that generate content automatically, either waiting for approval or publishing on their own, with a full run history.',
    milestone: MILESTONES.growth,
  },
  {
    path: '/analytics',
    label: 'Analytics',
    icon: ChartColumn,
    description: 'Track reach, engagement and post performance for each connected account.',
    milestone: MILESTONES.growth,
  },
  {
    path: '/brands',
    label: 'Brand Profiles',
    icon: Palette,
    description:
      'Describe each brand’s tone, audience and guidelines so generated content stays on-brand.',
    milestone: MILESTONES.aiInfrastructure,
  },
  {
    path: '/team',
    label: 'Team',
    icon: Users,
    description:
      'Invite teammates as staff, change roles and remove members. Owners keep full control of the workspace.',
    milestone: MILESTONES.workspaces,
  },
  {
    path: '/billing',
    label: 'Billing',
    icon: CreditCard,
    description: 'Choose a subscription plan, track usage against its limits and manage payments.',
    milestone: MILESTONES.growth,
  },
];

function plannedItems(paths: string[]): NavigationItem[] {
  return paths.map((path) => {
    const module = PLANNED_MODULES.find((candidate) => candidate.path === path);
    if (!module) throw new Error(`Unknown module path in navigation: ${path}`);
    return { path: module.path, label: module.label, icon: module.icon, planned: true };
  });
}

export const NAVIGATION: NavigationSection[] = [
  {
    items: [{ path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, planned: false }],
  },
  {
    title: 'Workspace',
    items: plannedItems([
      '/accounts',
      '/ai-studio',
      '/calendar',
      '/posts',
      '/automations',
      '/analytics',
      '/brands',
    ]),
  },
  {
    title: 'Organization',
    items: [
      ...plannedItems(['/team', '/billing']),
      { path: '/settings', label: 'Workspace settings', icon: Settings, planned: false },
    ],
  },
];
