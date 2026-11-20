import { z } from 'zod';

export const WORKSPACE_NAME_MAX_LENGTH = 80;
export const WORKSPACE_DESCRIPTION_MAX_LENGTH = 1000;
/** Active workspaces one user may own. A safety cap until subscription plans set real limits. */
export const MAX_OWNED_WORKSPACES = 10;

/**
 * Roles inside one workspace. Platform administration is a separate concept and is never
 * expressed as a workspace role.
 */
export const WORKSPACE_ROLES = ['owner', 'staff'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const WORKSPACE_STATUSES = ['active', 'archived'] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const BUSINESS_CATEGORIES = [
  { value: 'fashion', label: 'Clothing and fashion' },
  { value: 'ecommerce', label: 'E-commerce' },
  { value: 'restaurant', label: 'Restaurants and food' },
  { value: 'education', label: 'Education' },
  { value: 'technology', label: 'Technology' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'beauty', label: 'Beauty and lifestyle' },
  { value: 'real_estate', label: 'Real estate' },
  { value: 'professional_services', label: 'Professional services' },
  { value: 'other', label: 'Other' },
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number]['value'];
const BUSINESS_CATEGORY_VALUES = BUSINESS_CATEGORIES.map((category) => category.value) as [
  BusinessCategory,
  ...BusinessCategory[],
];

/** Languages content can be written in by default (BCP 47 codes). */
export const WORKSPACE_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'Urdu' },
  { value: 'ar', label: 'Arabic' },
  { value: 'hi', label: 'Hindi' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'tr', label: 'Turkish' },
  { value: 'id', label: 'Indonesian' },
] as const;
export type WorkspaceLanguage = (typeof WORKSPACE_LANGUAGES)[number]['value'];
const WORKSPACE_LANGUAGE_VALUES = WORKSPACE_LANGUAGES.map((language) => language.value) as [
  WorkspaceLanguage,
  ...WorkspaceLanguage[],
];

export const DEFAULT_WORKSPACE_TIMEZONE = 'UTC';
export const DEFAULT_WORKSPACE_LANGUAGE: WorkspaceLanguage = 'en';

/** True for an IANA time zone name this runtime knows, e.g. "Asia/Karachi". */
export function isValidTimeZone(value: string): boolean {
  if (value.length === 0 || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** 24 hex characters: the only shape a record ID can have. Anything else is not looked up. */
export const recordIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid ID');

export const workspaceNameSchema = z
  .string({ error: 'Workspace name is required' })
  .trim()
  .min(1, 'Workspace name is required')
  .max(WORKSPACE_NAME_MAX_LENGTH, `Use at most ${WORKSPACE_NAME_MAX_LENGTH} characters`)
  // eslint-disable-next-line no-control-regex
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    error: 'Name contains invalid characters',
  });

const descriptionSchema = z
  .string()
  .trim()
  .max(
    WORKSPACE_DESCRIPTION_MAX_LENGTH,
    `Use at most ${WORKSPACE_DESCRIPTION_MAX_LENGTH} characters`,
  );

const categorySchema = z.enum(BUSINESS_CATEGORY_VALUES, { error: 'Choose a business category' });
const timezoneSchema = z
  .string({ error: 'Choose a time zone' })
  .refine(isValidTimeZone, { error: 'Choose a valid time zone' });
const languageSchema = z.enum(WORKSPACE_LANGUAGE_VALUES, { error: 'Choose a language' });

export const createWorkspaceRequestSchema = z.object({
  name: workspaceNameSchema,
  description: descriptionSchema.default(''),
  category: categorySchema.default('other'),
  timezone: timezoneSchema.default(DEFAULT_WORKSPACE_TIMEZONE),
  defaultLanguage: languageSchema.default(DEFAULT_WORKSPACE_LANGUAGE),
});
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequestSchema>;

/** Only the fields that are sent are changed. Unknown fields (status, owner, …) are rejected. */
export const updateWorkspaceRequestSchema = z
  .strictObject({
    name: workspaceNameSchema.optional(),
    description: descriptionSchema.optional(),
    category: categorySchema.optional(),
    timezone: timezoneSchema.optional(),
    defaultLanguage: languageSchema.optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    error: 'Nothing to update',
  });
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequestSchema>;

/** Archiving asks for the workspace name, so it cannot happen by a stray click or request. */
export const archiveWorkspaceRequestSchema = z.object({
  confirmName: z.string({ error: 'Type the workspace name to confirm' }),
});
export type ArchiveWorkspaceRequest = z.infer<typeof archiveWorkspaceRequestSchema>;

/** A workspace as one member sees it: `role` is the caller's own role in it. */
export const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: categorySchema,
  timezone: z.string(),
  defaultLanguage: languageSchema,
  status: z.enum(WORKSPACE_STATUSES),
  role: z.enum(WORKSPACE_ROLES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const workspaceResponseSchema = z.object({ workspace: workspaceSchema });
export type WorkspaceResponse = z.infer<typeof workspaceResponseSchema>;

export const workspaceListResponseSchema = z.object({ workspaces: z.array(workspaceSchema) });
export type WorkspaceListResponse = z.infer<typeof workspaceListResponseSchema>;

export const workspaceMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(WORKSPACE_ROLES),
  joinedAt: z.iso.datetime(),
});
export type WorkspaceMember = z.infer<typeof workspaceMemberSchema>;

export const workspaceMemberListResponseSchema = z.object({
  members: z.array(workspaceMemberSchema),
});
export type WorkspaceMemberListResponse = z.infer<typeof workspaceMemberListResponseSchema>;

export function businessCategoryLabel(value: BusinessCategory): string {
  return BUSINESS_CATEGORIES.find((category) => category.value === value)?.label ?? value;
}

export function workspaceLanguageLabel(value: WorkspaceLanguage): string {
  return WORKSPACE_LANGUAGES.find((language) => language.value === value)?.label ?? value;
}
