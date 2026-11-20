export const WORKSPACE_FIELDS = [
  'name',
  'description',
  'category',
  'timezone',
  'defaultLanguage',
] as const;
export type WorkspaceField = (typeof WORKSPACE_FIELDS)[number];
export type WorkspaceFormValues = Record<WorkspaceField, string>;

/** The visitor's own time zone is the most likely right answer for a new workspace. */
export function browserTimeZone(): string {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const emptyWorkspaceValues = (): WorkspaceFormValues => ({
  name: '',
  description: '',
  category: 'other',
  timezone: browserTimeZone(),
  defaultLanguage: 'en',
});
