/** Router state carried to /login: where the user was going. */
export interface RedirectState {
  from?: string;
}

/** Only follow in-app paths, never an absolute or protocol-relative URL (open-redirect guard). */
export function safeRedirectTarget(from: string | undefined): string {
  return from?.startsWith('/') && !from.startsWith('//') ? from : '/dashboard';
}
