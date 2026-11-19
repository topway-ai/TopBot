import { describe, expect, it, vi } from "vitest";
import { chatReleaseCommand, connectChatRelease, createTopBotChatRelease } from "./topbot-chat-release.ts";

const repo = "/repos/topway-ai/TopBot";
const base = "a".repeat(40), head = "b".repeat(40), moved = "c".repeat(40);
const code = "0123456789abcdef";
const prepare = { kind: "prepare", pr: 7 } as const;
const confirm = { kind: "publish", code } as const;
const packageFile = (version: string, scripts = {}) => ({ type: "file", encoding: "base64", size: 100,
  content: Buffer.from(JSON.stringify({ name: "topbot", version, scripts })).toString("base64") });

async function fixture() {
  const mutations: Array<[string, string, unknown]> = [];
  const state = { time: 0, idle: true, draft: true, missingVersion: true, file: "topbot-release-notes/layout.txt", mode: "100644", previous: undefined as string | undefined,
    check: "success", ci: "success", head, main: base, parent: base, baseRef: "main", protected: false, race: "", unknownDispatch: false, user: "topway-ai", metadata: {},
    version: "0.1.161-topbot.9", lastRelease: "v0.1.161-topbot.6", ruleset: true, repoId: "R_kgDOVvY7xw", updatedAt: "2026-11-18T20:00:00Z" };
  const read = (path: string) => {
    if (path === "/user") return { login: state.user };
    if (path.startsWith(`${repo}/rulesets?`)) return state.ruleset ? [{ id: 12, enforcement: "active" }] : [];
    if (path === `${repo}/rulesets/12`) return { id: 12, source_type: "Repository", source: "topway-ai/TopBot", updated_at: state.updatedAt,
      target: "tag", enforcement: "active", bypass_actors: [], conditions: { ref_name: { include: ["refs/tags/v*"], exclude: [] } }, rules: [{ type: "update" }, { type: "deletion" }] };
    if (path === `${repo}/pulls/7`) return { node_id: "pr7", number: 7, state: "open", draft: state.draft, mergeable: true, changed_files: 2,
      base: { ref: state.baseRef, sha: base, repo: { full_name: "topway-ai/TopBot", node_id: state.repoId } },
      head: { ref: "topbot-dev/layout", sha: state.head, repo: { full_name: "topway-ai/TopBot", node_id: state.repoId } } };
    if (path === `${repo}/branches/main`) return { commit: { sha: state.main }, protected: state.protected };
    if (path === `${repo}/compare/${base}...${state.head}?per_page=1`) return { merge_base_commit: { sha: base }, ahead_by: 1,
      commits: [{ sha: state.head, parents: [{ sha: state.parent }], commit: { tree: { sha: moved } } }], files: [
      { filename: "package.json", status: "modified", additions: 1, deletions: 1 },
      { filename: state.file, previous_filename: state.previous, status: "modified", additions: 5, deletions: 3 },
    ] };
    if (path === `${repo}/contents/package.json?ref=${base}`) return packageFile("0.1.161-topbot.8");
    if (path === `${repo}/git/trees/${moved}`) return { sha: moved, truncated: false, tree: [
      { path: "package.json", mode: "100644", type: "blob", sha: head }, { path: "topbot-release-notes", mode: "040000", type: "tree", sha: base },
    ] };
    if (path === `${repo}/git/trees/${base}`) return { sha: base, truncated: false, tree: [
      { path: "layout.txt", mode: state.mode, type: "blob", sha: head },
    ] };
    if (path === `${repo}/contents/package.json?ref=${state.head}`) return packageFile(state.version, state.metadata);
    if (path === `${repo}/actions/workflows/topbot-development-checks.yml/runs?event=pull_request&head_sha=${state.head}&per_page=1`) return { workflow_runs: [
      { id: 53, head_sha: state.head, head_branch: "topbot-dev/layout", event: "pull_request", path: ".github/workflows/topbot-development-checks.yml", status: "completed", conclusion: state.check },
    ] };
    if (path === `${repo}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${state.head}&per_page=1`) return { workflow_runs: [
      { id: 54, head_sha: state.head, head_branch: "topbot-dev/layout", event: "pull_request", path: ".github/workflows/ci.yml", status: "completed", conclusion: state.ci },
    ] };
    if (path === `${repo}/commits/main`) return { sha: state.main };
    if (path === `${repo}/releases?per_page=20`) return [{ tag_name: state.lastRelease, draft: false, prerelease: false }];
    if (path === `${repo}/releases/tags/v${state.version}` || path === `${repo}/git/ref/tags/v${state.version}`) return state.missingVersion ? undefined : {};
    throw new Error(`Unexpected GitHub request: ${path}`);
  };
  const request = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toMatch(/^https:\/\/api\.github\.com\//);
    expect(init?.redirect).toBe("error");
    const path = String(url).slice("https://api.github.com".length);
    if (init?.method === "GET") {
      const data = read(path);
      return data === undefined ? new Response(null, { status: 404 }) : Response.json(data);
    }
    mutations.push([path, init?.method ?? "", JSON.parse(String(init?.body))]);
    if (path === "/graphql") {
      const { query, variables: { input } } = JSON.parse(String(init?.body));
      expect(query).toContain("updateRefs(input: $input)");
      expect(input.repositoryId).toBe("R_kgDOVvY7xw");
      if (state.race === "base") state.main = moved;
      if (state.race === "head") state.head = moved;
      if (state.race === "retarget") state.baseRef = "another-branch";
      const refs = new Map([["refs/heads/main", state.main], ["refs/heads/topbot-dev/layout", state.head]]);
      if (input.refUpdates.some((r: { name: string; beforeOid: string }) => refs.get(r.name) !== r.beforeOid)) {
        return Response.json({ errors: [{ message: "stale ref" }], data: { updateRefs: null } });
      }
      for (const r of input.refUpdates) { expect(r.force).toBe(false); refs.set(r.name, r.afterOid); }
      state.main = refs.get("refs/heads/main")!;
      return Response.json({ data: { updateRefs: { clientMutationId: input.clientMutationId } } });
    }
    if (path === `${repo}/actions/workflows/topbot-windows-update.yml/dispatches`) {
      if (state.unknownDispatch) throw new Error("unknown transport state (never show raw errors)");
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected GitHub mutation: ${path}`);
  });
  const run = createTopBotChatRelease({ installedVersion: () => "0.1.161-topbot.8", connect: () => connectChatRelease(request, async () => "synthetic"),
    now: () => state.time, eligible: () => state.idle, randomCode: () => code });
  return { run, state, mutations, request };
}

describe("TopBot formal release from desktop chat", () => {
  it("takes only explicit release commands and treats malformed commands as help", () => {
    expect(chatReleaseCommand("confirm release")).toBeNull();
    expect(chatReleaseCommand("/topbot-release 7")).toEqual(prepare);
    expect(chatReleaseCommand(`/topbot-publish ${code}`)).toEqual(confirm);
    expect(chatReleaseCommand("/topbot-release 7\nhello")).toEqual({ kind: "help" });
  });

  it("previews without mutation; one confirmation advances the pinned main and dispatches once", async () => {
    const f = await fixture();
    const preview = await f.run("chat", prepare);
    expect(preview).toContain(head);
    expect(preview).toContain("0.1.161-topbot.9");
    expect(preview).toContain("topbot-release-notes/layout.txt");
    expect(preview).toContain(`/topbot-publish ${code}`);
    expect(f.mutations).toEqual([]);
    expect(await f.run("other-chat", confirm)).toContain("无效");
    const messages = await Promise.all([f.run("chat", confirm), f.run("chat", confirm)]);
    expect(messages[0]).toContain("尚未正式发布");
    expect(messages[1]).toContain("正在处理");
    expect(f.mutations).toEqual([
      ["/graphql", "POST", expect.objectContaining({ variables: { input: { repositoryId: "R_kgDOVvY7xw", clientMutationId: head, refUpdates: [
        { name: "refs/heads/topbot-dev/layout", beforeOid: head, afterOid: head, force: false },
        { name: "refs/heads/main", beforeOid: base, afterOid: head, force: false },
      ] } } })],
      [`${repo}/actions/workflows/topbot-windows-update.yml/dispatches`, "POST", { ref: "main", inputs: { publish: "true", reviewed_sha: head, reviewed_tag_ruleset: "12@2026-11-18T20:00:00Z" } }],
    ]);
    expect(await f.run("chat", confirm)).toContain("无效");
  });

  it.each([
    { time: 300_000 }, { head: "d".repeat(40) }, { main: "d".repeat(40) }, { check: "failure" }, { draft: false },
    { parent: moved }, { protected: true }, { baseRef: "other" }, { ci: "failure" },
    { ruleset: false }, { updatedAt: "2026-11-18T20:01:00Z" }, { repoId: "different-repository" },
  ])("does not mutate if confirmation became stale: %o", async (change) => {
    const f = await fixture();
    await f.run("chat", prepare);
    Object.assign(f.state, change);
    expect(await f.run("chat", confirm)).not.toContain("已进入发布队列");
    expect(f.mutations).toEqual([]);
  });

  it.each([
    { file: ".github/workflows/topbot-windows-update.yml" }, { file: "electron/main.mjs" }, { file: "server/request-auth.ts" },
    { file: "docs/example.md" }, { mode: "120000" }, { mode: "100755" },
    { previous: "electron/main.mjs" }, { metadata: { prepare: "changed" } }, { version: "0.1.161-topbot.8" },
    { missingVersion: false }, { user: "someone-else" }, { idle: false }, { lastRelease: "v0.1.161-topbot.10" },
  ])("does not offer confirmation for ineligible PRs: %o", async (change) => {
    const f = await fixture();
    Object.assign(f.state, change);
    expect(await f.run("chat", prepare)).not.toContain(`/topbot-publish ${code}`);
    expect(await f.run("chat", confirm)).not.toContain("已进入发布队列");
    expect(f.mutations).toEqual([]);
  });

  it.each(["head", "base"])("does not change either ref or dispatch on a %s race at write time", async (race) => {
    const f = await fixture();
    await f.run("chat", prepare);
    f.state.race = race;
    expect(await f.run("chat", confirm)).toContain("不会自动重试");
    expect(f.state.main).toBe(race === "base" ? moved : base);
    expect(f.state.head).toBe(race === "head" ? moved : head);
    expect(f.mutations.map(([path]) => path)).toEqual(["/graphql"]);
  });

  it("a PR retargeted after confirmation cannot redirect the approved ref update", async () => {
    const f = await fixture();
    await f.run("chat", prepare);
    f.state.race = "retarget";
    expect(await f.run("chat", confirm)).toContain("尚未正式发布");
    expect(f.state.baseRef).toBe("another-branch");
    expect(f.state.main).toBe(head);
    expect(JSON.stringify(f.mutations)).not.toContain("another-branch");
  });

  it("does not expose raw errors or retry a dispatch with an ambiguous outcome", async () => {
    const f = await fixture();
    f.state.unknownDispatch = true;
    await f.run("chat", prepare);
    const report = await f.run("chat", confirm);
    expect(report).toContain("不会自动重试");
    expect(report).not.toContain("unknown transport state");
    expect(await f.run("chat", confirm)).toContain("无效");
    expect(f.mutations.filter(([path]) => path.endsWith("/dispatches"))).toHaveLength(1);
  });
});
