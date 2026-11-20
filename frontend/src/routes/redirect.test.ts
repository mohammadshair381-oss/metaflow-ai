import { describe, expect, it } from 'vitest';
import { safeRedirectTarget } from './redirect';

describe('safeRedirectTarget (open-redirect guard)', () => {
  it.each([
    '/',
    '/dashboard',
    '/calendar',
    '/analytics?range=30d',
    '/settings#profile',
    '/content/drafts?status=pending&page=2#top',
    // Percent-encoded slashes stay a path on this site.
    '/%2F%2Fevil.example',
  ])('follows the internal path %j unchanged', (path) => {
    expect(safeRedirectTarget(path)).toBe(path);
  });

  it.each([
    ['protocol-relative', '//evil.example'],
    ['protocol-relative with path', '//evil.example/dashboard'],
    ['backslash protocol-relative', '/\\evil.example'],
    ['backslash then slash', '/\\/evil.example'],
    ['double backslash', '\\\\evil.example'],
    ['tab hidden between slashes', '/\t/evil.example'],
    ['newline hidden between slashes', '/\n/evil.example'],
    ['tab before a backslash', '/\t\\evil.example'],
  ])('rejects a %s target', (_label, target) => {
    expect(safeRedirectTarget(target)).toBe('/dashboard');
  });

  it.each([
    'https://evil.example',
    'http://evil.example/dashboard',
    'HTTPS://evil.example',
    'javascript:alert(1)',
    'data:text/html,hi',
    'evil.example',
    ' /dashboard',
  ])('rejects the external or non-path target %j', (target) => {
    expect(safeRedirectTarget(target)).toBe('/dashboard');
  });

  it('falls back to the dashboard when there is no target', () => {
    expect(safeRedirectTarget(undefined)).toBe('/dashboard');
    expect(safeRedirectTarget('')).toBe('/dashboard');
  });
});
