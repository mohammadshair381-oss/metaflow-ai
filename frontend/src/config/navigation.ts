import {
  CalendarDays,
  ChartColumn,
  CreditCard,
  FileText,
  LayoutDashboard,
  Palette,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

export interface NavigationItem {
  label: string;
  icon: LucideIcon;
  /** Present only for modules that exist. Planned modules render as disabled entries. */
  href?: string;
}

export interface NavigationSection {
  title?: string;
  items: NavigationItem[];
}

/**
 * Sidebar structure. Entries without `href` are planned and shown as "Soon" —
 * they are deliberately not links, so nothing pretends to work before it is built.
 */
export const NAVIGATION: NavigationSection[] = [
  {
    items: [{ label: 'Overview', icon: LayoutDashboard, href: '/' }],
  },
  {
    title: 'Workspace',
    items: [
      { label: 'Social Accounts', icon: Share2 },
      { label: 'AI Studio', icon: Sparkles },
      { label: 'Content Calendar', icon: CalendarDays },
      { label: 'Posts', icon: FileText },
      { label: 'Automation Center', icon: Workflow },
      { label: 'Analytics', icon: ChartColumn },
      { label: 'Brand Profiles', icon: Palette },
    ],
  },
  {
    title: 'Organization',
    items: [
      { label: 'Team', icon: Users },
      { label: 'Billing', icon: CreditCard },
      { label: 'Settings', icon: Settings },
      { label: 'Admin Console', icon: ShieldCheck },
    ],
  },
];
