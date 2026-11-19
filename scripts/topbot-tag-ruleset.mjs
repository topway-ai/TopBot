const repository = "topway-ai/TopBot";
const endpoint = `/repos/${repository}/rulesets`;
const tagPattern = /^v\d+\.\d+\.\d+(?:-topbot\.\d+)?$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const pageSize = 10, maxPages = 2;

export function tagRulesetProof(rule, tagName, ownerProof = "") {
  if (typeof tagName !== "string" || !tagPattern.test(tagName) || !Number.isSafeInteger(rule?.id) || rule.id <= 0 ||
      typeof rule.updated_at !== "string" || !timestamp.test(rule.updated_at) || rule.source_type !== "Repository" || rule.source !== repository ||
      rule.target !== "tag" || rule.enforcement !== "active") return null;
  const proof = `${rule.id}@${rule.updated_at}`;
  // GitHub hides bypass_actors from tokens without ruleset write access. Only the
  // owner's dispatch may vouch for a redacted list, never for a visible bypass.
  if (Object.hasOwn(rule, "bypass_actors") ? !Array.isArray(rule.bypass_actors) || rule.bypass_actors.length !== 0
    : ownerProof !== proof) return null;
  const refs = rule.conditions?.ref_name;
  const matches = ["~ALL", "refs/tags/*", "refs/tags/v*", `refs/tags/${tagName}`];
  if (!refs || Object.keys(rule.conditions).length !== 1 || !Array.isArray(refs.exclude) || refs.exclude.length ||
      !Array.isArray(refs.include) || !refs.include.some(pattern => matches.includes(pattern)) ||
      !Array.isArray(rule.rules) || rule.rules.some(r => typeof r?.type !== "string" || r.type === "creation") ||
      !rule.rules.some(r => r.type === "deletion") ||
      !rule.rules.some(r => r.type === "update" && (r.parameters === undefined || r.parameters?.update_allows_fetch_and_merge === false))) return null;
  return proof;
}

/** request(path) reads parsed JSON from GitHub. Chat must see an explicitly empty bypass list. */
export async function resolveTagRulesetProof(request, tagName) {
  if (!tagPattern.test(tagName)) return null;
  try {
    for (let page = 1; page <= maxPages; page++) {
      const rules = await request(`${endpoint}?targets=tag&includes_parents=false&per_page=${pageSize}&page=${page}`);
      if (!Array.isArray(rules) || rules.length > pageSize) return null;
      for (const { id, enforcement } of rules) {
        if (enforcement !== "active" || !Number.isSafeInteger(id) || id <= 0) continue;
        const detail = await request(`${endpoint}/${id}`);
        if (detail?.id !== id) return null;
        const proof = tagRulesetProof(detail, tagName);
        if (proof) return proof;
      }
      if (rules.length < pageSize) break;
    }
    return null;
  } catch {
    return null;
  }
}
