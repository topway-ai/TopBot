export function resolveTagRulesetProof(request: (path: string) => Promise<unknown>, tagName: string): Promise<string | null>;
export function tagRulesetProof(rule: unknown, tagName: string, ownerProof?: string): string | null;
