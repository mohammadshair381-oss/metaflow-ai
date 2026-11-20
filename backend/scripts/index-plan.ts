/** An index as declared on a Mongoose schema: [keys, options]. */
export type DeclaredIndex = [Record<string, unknown>, Record<string, unknown>];

/** An index as reported by MongoDB's listIndexes. */
export interface ExistingIndex {
  name: string;
  key: Record<string, unknown>;
}

export interface IndexPlan {
  present: string[];
  missing: string[];
}

const keyOf = (key: Record<string, unknown>) => JSON.stringify(Object.entries(key));

/** Compares declared and existing indexes by key pattern. Never proposes dropping anything. */
export function planIndexes(declared: DeclaredIndex[], existing: ExistingIndex[]): IndexPlan {
  const existingKeys = new Set(existing.map((index) => keyOf(index.key)));
  const plan: IndexPlan = { present: [], missing: [] };
  for (const [key, options] of declared) {
    const label = typeof options.name === 'string' ? options.name : keyOf(key);
    (existingKeys.has(keyOf(key)) ? plan.present : plan.missing).push(label);
  }
  return plan;
}
