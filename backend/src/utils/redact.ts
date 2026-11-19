/** Keys whose values are never written to logs. */
const SENSITIVE_KEY_PATTERN =
  /pass(word)?|secret|token|cookie|authorization|api[-_]?key|private[-_]?key|credential|uri$/i;

const CONNECTION_STRING_CREDENTIALS = /(mongodb(?:\+srv)?:\/\/)[^@/\s]+@/gi;

export const REDACTED = '[REDACTED]';

/** Replace `user:password@` in MongoDB connection strings embedded in free text. */
export function redactConnectionStrings(text: string): string {
  return text.replace(CONNECTION_STRING_CREDENTIALS, `$1${REDACTED}@`);
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Deep-copy a value for logging: masks sensitive keys, strips credentials from
 * connection strings and turns Error objects into plain serializable objects.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[Truncated]';
  if (typeof value === 'string') return redactConnectionStrings(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactConnectionStrings(value.message),
      ...(value.stack ? { stack: redactConnectionStrings(value.stack) } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((item) => redactForLog(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = isSensitiveKey(key) ? REDACTED : redactForLog(entry, depth + 1);
    }
    return output;
  }
  return value;
}
