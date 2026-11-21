import {
  CalendarDays,
  ChartColumn,
  CreditCard,
  FileText,
  Images,
  LayoutDashboard,
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
  content: { number: 6, name: 'Content management' },
  publishing: { number: 7, name: 'Scheduling, approvals and publishing' },
  growth: { number: 8, name: 'Automation, analytics, billing and administration' },
} as const;

/** Modules that are routed but not built. Each renders an honest empty state. */
export const PLANNED_MODULES: PlannedModule[] = [
  {
    path: '/calendar',
    label: 'Content Calendar',
    icon: CalendarDays,
    description:
      'See scheduled and published posts across every connected account on one calendar.',
    milestone: MILESTONES.publishing,
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
    items: [
      { path: '/accounts', label: 'Social Accounts', icon: Share2, planned: false },
      { path: '/ai-studio', label: 'AI Studio', icon: Sparkles, planned: false },
      { path: '/posts', label: 'Posts', icon: FileText, planned: false },
      { path: '/media', label: 'Media Library', icon: Images, planned: false },
      ...plannedItems(['/calendar', '/automations', '/analytics']),
    ],
  },
  {
    title: 'Organization',
    items: [
      ...plannedItems(['/team', '/billing']),
      { path: '/settings', label: 'Workspace settings', icon: Settings, planned: false },
    ],
  },
];
