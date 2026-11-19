import { normalizeTagRulesetProof } from "./topbot-tag-ruleset.mjs";

const repository = "topway-ai/TopBot";
const repositoryId = "R_kgDOVvY7xw";
const owner = "topway-ai";
const repo = `/repos/${repository}`;
const shaPattern = /^[a-f0-9]{40}$/;
const isId = (value) => Number.isSafeInteger(value) && value > 0;
const isName = (name) => typeof name === "string" && /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(name);
const sameRepo = (value) => value?.full_name === repository && value?.node_id === repositoryId;
// This exact revision was read back by the owner with an explicitly empty bypass list.
const mainRuleId = 27644709;
const mainRuleRevision = "27644709@2026-11-19T14:16:35.74Z";

export class TopBotReleaseGateError extends Error {}
const requireGate = (condition, reason) => {
  if (!condition) throw new TopBotReleaseGateError(reason);
};

async function verifyMainPolicy(read, sha) {
  const main = await read(`${repo}/branches/main`);
  requireGate(main?.protected === true && main?.commit?.sha === sha, "当前受保护的 main 与待发布提交不一致。");
  const detail = await read(`${repo}/rulesets/${mainRuleId}`);
  const selector = detail?.conditions?.ref_name;
  requireGate(detail?.id === mainRuleId && detail.source_type === "Repository" && detail.source === repository &&
    detail.target === "branch" && detail.enforcement === "active" && selector?.include?.length === 1 &&
    selector.include[0] === "refs/heads/main" && Array.isArray(selector.exclude) && selector.exclude.length === 0 &&
    normalizeTagRulesetProof(`${detail.id}@${detail.updated_at}`) === mainRuleRevision &&
    (!Object.hasOwn(detail, "bypass_actors") || (Array.isArray(detail.bypass_actors) && detail.bypass_actors.length === 0)),
  "main 的无绕过审核规则已变更，需独立复审后才能发布。");
  const rules = await read(`${repo}/rules/branches/main`);
  requireGate(Array.isArray(rules) && rules.some(rule => {
    const p = rule?.parameters;
    return rule?.type === "pull_request" && p?.required_approving_review_count >= 1 &&
      p.dismiss_stale_reviews_on_push === true && p.require_last_push_approval === true &&
      p.required_review_thread_resolution === true;
  }) && rules.some(rule => rule?.type === "required_status_checks" &&
    rule.parameters?.strict_required_status_checks_policy === true &&
    rule.parameters.required_status_checks?.some(check => check?.context === "CI" && check.integration_id === 15368)),
  "main 必须保留独立 PR 审核和严格的 GitHub Actions CI 保护。");
  requireGate((await read(`${repo}/immutable-releases`))?.enabled === true, "无法确认 GitHub 不可变 Release 已启用。");
}

async function verifyApproval(read, pr, mergedAt) {
  const latest = new Map();
  for (let page = 1; page <= 5; page++) {
    const reviews = await read(`${repo}/pulls/${pr.number}/reviews?per_page=100&page=${page}`);
    requireGate(Array.isArray(reviews) && reviews.length <= 100, "无法完整读取 PR 审核记录。");
    for (const review of reviews) {
      if (!["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review?.state)) continue;
      const by = review.user;
      if (by?.type !== "User" || !isName(by.login) || !isId(by.id)) continue;
      const time = Date.parse(review.submitted_at);
      requireGate(Number.isFinite(time) && isId(review.id), "GitHub 审核时间不可核验。");
      const existing = latest.get(by.id);
      if (!existing || time > existing.time || (time === existing.time && review.id > existing.review.id)) {
        latest.set(by.id, { time, review });
      }
    }
    if (reviews.length < 100) {
      for (const { time, review } of latest.values()) {
        const by = review.user;
        if (review.state !== "APPROVED" || review.commit_id !== pr.head.sha || time > mergedAt ||
            by.id === pr.user.id || by.login.toLowerCase() === owner) continue;
        const reviewer = await read(`${repo}/collaborators/${encodeURIComponent(by.login)}/permission`);
        if (reviewer?.user?.id === by.id && ["write", "maintain", "admin"].includes(reviewer?.permission)) return review.id;
      }
      break;
    }
  }
  throw new TopBotReleaseGateError("缺少有审核权限的独立人员对确切 PR 提交的有效批准。");
}

/** Both chat and the workflow must validate the same read-only production policy. */
export async function verifyWindowsReleaseGate(read, sha, expectedPR) {
  requireGate(typeof sha === "string" && shaPattern.test(sha), "无效的待发布提交。");
  await verifyMainPolicy(read, sha);
  const matches = await read(`${repo}/commits/${sha}/pulls?per_page=100`);
  requireGate(Array.isArray(matches) && matches.length > 0 && matches.length < 100, "无法唯一确定该提交的来源 PR。");
  const merged = matches.filter(pr => pr?.merge_commit_sha === sha && isId(pr.number));
  requireGate(merged.length === 1 && (expectedPR === undefined || merged[0].number === expectedPR), "该提交不是指定 PR 的唯一合并提交。");
  const pr = await read(`${repo}/pulls/${merged[0].number}`);
  requireGate(pr?.number === merged[0].number && pr.merge_commit_sha === sha && pr.state === "closed" &&
    pr.merged === true && pr.draft === false && pr.base?.ref === "main" && sameRepo(pr.base.repo) &&
    isId(pr.user?.id) && pr.head?.sha && shaPattern.test(pr.head.sha), "指定 PR 未合并到 TopBot 的受保护 main。");
  const mergedAt = Date.parse(pr.merged_at);
  requireGate(Number.isFinite(mergedAt), "GitHub 合并时间不可核验。");
  const [commit, head] = await Promise.all([read(`${repo}/commits/${sha}`), read(`${repo}/commits/${pr.head.sha}`)]);
  requireGate(commit?.sha === sha && Array.isArray(commit.parents) && commit.parents.length === 2 &&
    shaPattern.test(commit.parents[0]?.sha) && commit.parents[1]?.sha === pr.head.sha &&
    typeof commit.commit?.tree?.sha === "string" && shaPattern.test(commit.commit.tree.sha) &&
    head?.sha === pr.head.sha && head.commit?.tree?.sha === commit.commit.tree.sha,
  "实际合并的代码树不等于独立批准的候选。");
  const approval = await verifyApproval(read, pr, mergedAt);
  // Manual runs of ci.yml use its full cross-platform lane, not the selective PR/push lane.
  const runs = await read(`${repo}/actions/workflows/ci.yml/runs?event=workflow_dispatch&branch=main&head_sha=${sha}&per_page=1`);
  const run = runs?.workflow_runs?.[0];
  requireGate(isId(run?.id) && isId(run.run_attempt) && run.event === "workflow_dispatch" && run.head_sha === sha &&
    run.head_branch === "main" && sameRepo(run.head_repository) && /^\.github\/workflows\/ci\.yml(?:@refs\/heads\/main)?$/.test(run.path) &&
    run.status === "completed" && run.conclusion === "success", "确切 main 提交的完整 CI 尚未通过。");
  const jobs = await read(`${repo}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  requireGate(Array.isArray(jobs?.jobs) && jobs.jobs.some(job => job?.name === "CI" && job.head_sha === sha &&
    job.status === "completed" && job.conclusion === "success"), "完整 CI 的最终检查没有成功。");
  return { pullRequest: pr.number, head: pr.head.sha, base: commit.parents[0].sha, sha, tree: commit.commit.tree.sha,
    ciRun: run.id, ciAttempt: run.run_attempt, approval };
}
