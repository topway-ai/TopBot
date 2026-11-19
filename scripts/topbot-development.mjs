import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, statfsSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = "topway-ai/TopBot";
const origin = `https://github.com/${repo}.git`;
const baseRef = "refs/remotes/origin/main";
const GiB = 1024 ** 3;
const sha = /^[a-f0-9]{40}$/;
const slug = /^[a-z0-9][a-z0-9-]{0,39}$/;
const protectedPath = /^(?:\.github\/|AGENTS\.md$|electron\/|scripts\/(?:topbot-|close-legacy-|install-|package-|verify-topbot-)|skills\/topbot-development\/|server\/(?:request-auth|permissions|.*migration|sessions|config|harness\/registry|move-freeze))/i;
const privatePath = /(?:^|\/)(?:\.env(?:\.|$)|\.openmausbot(?:\/|$)|\.omb-scratch(?:\/|$)|node_modules\/|dist(?:-[^/]+)?\/|release\/|performance-results\/|credentials?(?:\.|\/)|secrets?(?:\.|\/))|\.(?:key|pem|pfx|sqlite3?|db|gguf|log|zip|exe)$/i;
const allowedSource = /\.(?:[cm]?[jt]sx?|ya?ml|json|mdx?|css|html?|svg|toml|lock|txt|ps1|sh|cjs|mjs)$/i;
const secret = /(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{35,}|sk-(?:proj-)?[a-zA-Z0-9_-]{40,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const privateReference = /(?:[A-Z]:\\(?:Users|ProgramData)\\|\/home\/[^/\s]+\/\.openmausbot\/)/i;

function objectFile(file) { return JSON.parse(readFileSync(file, "utf8")); }
function atomicJson(file, value) {
  const pending = `${file}.${process.pid}.pending`;
  writeFileSync(pending, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  renameSync(pending, file);
}

export function gitAt(cwd, args, { input, hidden = false } = {}) {
  try {
    return execFileSync("git", args, { cwd, input, encoding: "utf8", timeout: 120_000, windowsHide: true,
      maxBuffer: 2 * 1024 * 1024, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" } });
  } catch (error) {
    if (hidden) throw new Error("GitHub credentials are unavailable. Authorize the repository's account outside the bot chat.");
    throw new Error(`git ${args[0]} failed: ${String(error.stderr ?? "").trim().slice(-900) || error.code || error.status}`);
  }
}

function samePath(a, b) {
  const canonical = value => process.platform === "win32" ? realpathSync(value).toLowerCase() : realpathSync(value);
  return canonical(a) === canonical(b);
}

export function analyzeFiles(worktree, files, addedLines = "") {
  const blocked = [], ownerReview = [];
  for (const file of files) {
    if (privatePath.test(file) || !allowedSource.test(file) || /[\x00-\x1f\x7f]/.test(file)) {
      blocked.push({ file, reason: "Outside the text source allowlist" });
      continue;
    }
    if (protectedPath.test(file)) ownerReview.push(file);
    const absolute = path.resolve(worktree, file);
    if (!absolute.startsWith(worktree + path.sep)) { blocked.push({ file, reason: "Outside the worktree" }); continue; }
    if (existsSync(absolute)) {
      const info = lstatSync(absolute);
      if (!info.isFile() || !realpathSync(absolute).startsWith(worktree + path.sep)) {
        blocked.push({ file, reason: "Linked or non-regular path" });
      } else if (info.size > 1024 ** 2 || readFileSync(absolute).includes(0)) {
        blocked.push({ file, reason: "Large or binary file" });
      }
    }
  }
  if (secret.test(addedLines) || privateReference.test(addedLines)) blocked.push({ reason: "Possible credential or private machine path in added lines" });
  return { blocked, ownerReview };
}

function authenticatedGitHub(checkout, request = fetch) {
  const credential = gitAt(checkout, ["-c", "credential.interactive=false", "credential", "fill"], {
    input: `protocol=https\nhost=github.com\npath=${repo}.git\nusername=topway-ai\n\n`, hidden: true,
  }).split(/\r?\n/).find(line => line.startsWith("password="))?.slice(9);
  if (!credential) throw new Error("No cached GitHub credential for the TopBot repository.");
  return async (urlPath, payload) => {
    const response = await request(`https://api.github.com${urlPath}`, { redirect: "error", signal: AbortSignal.timeout(20_000),
      method: payload ? "POST" : "GET", headers: { authorization: `Bearer ${credential}`, "user-agent": "TopBot-Development",
        accept: "application/vnd.github+json", "content-type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`GitHub returned HTTP ${response.status}; no approval or release was attempted.`); }
    return response.json();
  };
}

export async function runDevelopment(args, { home = path.join(os.homedir(), ".topbot-development"), git = gitAt,
  availableRam = os.freemem, disk = statfsSync, connect = authenticatedGitHub } = {}) {
  const [command, value, ...extra] = args;
  if (!["doctor", "start", "review", "draft", "finish"].includes(command) || extra.length ||
      (command === "start" ? !slug.test(value ?? "") : value !== undefined)) {
    throw new Error("Use doctor, start <slug>, review, draft, or finish.");
  }
  const { checkout, worktrees } = objectFile(path.join(home, "config.json"));
  if (![checkout, worktrees].every(value => typeof value === "string" && path.isAbsolute(value))) throw new Error("Configure absolute checkout and worktree paths.");
  const root = realpathSync(worktrees), repoRoot = realpathSync(checkout);
  if (root === repoRoot || root.startsWith(repoRoot + path.sep) || repoRoot.startsWith(root + path.sep)) {
    throw new Error("The worktree root must be separate from the original checkout.");
  }
  const localGit = (...args) => git(repoRoot, args).trim();
  if (localGit("remote", "get-url", "origin") !== origin || localGit("remote", "get-url", "--push", "origin") !== origin) {
    throw new Error(`Expected the development checkout to point to ${origin}.`);
  }
  const stateFile = path.join(home, "active.json");
  const state = () => existsSync(stateFile) ? objectFile(stateFile) : null;
  const resources = () => {
    const stats = disk(root);
    return { freeRAM: availableRam(), freeDisk: stats.bavail * stats.bsize, minimumRAM: 3 * GiB, minimumDisk: 6 * GiB };
  };
  const preflight = () => {
    const r = resources();
    if (r.freeRAM < r.minimumRAM || r.freeDisk < r.minimumDisk) throw new Error("Development paused: need 3 GiB free RAM and 6 GiB free staging disk.");
  };
  const review = job => {
    if (!job || !slug.test(job.slug) || job.branch !== `topbot-dev/${job.slug}` || !sha.test(job.base)) throw new Error("No valid active development job.");
    const candidate = path.join(root, job.slug);
    if (!samePath(candidate, job.path) || !samePath(candidate, git(candidate, ["rev-parse", "--show-toplevel"]).trim()) ||
        git(candidate, ["branch", "--show-current"]).trim() !== job.branch ||
        git(candidate, ["remote", "get-url", "--push", "origin"]).trim() !== origin) throw new Error("The active worktree or its push target no longer matches the job.");
    git(candidate, ["merge-base", "--is-ancestor", job.base, "HEAD"]);
    const files = [...new Set([git(candidate, ["diff", "--name-only", "--no-renames", "-z", job.base, "--"]),
      git(candidate, ["ls-files", "--others", "--exclude-standard", "-z"])].join("").split("\0").filter(Boolean))].sort();
    const lines = git(candidate, ["diff", "--no-ext-diff", "--no-renames", "--unified=0", job.base, "--"])
      .split("\n").filter(line => line.startsWith("+") && !line.startsWith("+++")).join("\n");
    const dirty = Boolean(git(candidate, ["status", "--porcelain", "--untracked-files=all"]).trim());
    return { ...job, head: git(candidate, ["rev-parse", "HEAD"]).trim(), dirty, files, ...analyzeFiles(candidate, files, lines) };
  };
  if (command === "doctor") return { repository: repo, checkout: repoRoot, worktrees: root, active: state(), resources: resources(),
    localBuilds: "focused tests only; Windows packaging belongs on GitHub Actions", release: "not available through this controller" };
  if (command === "review") return review(state());

  const lock = path.join(home, "operation.lock");
  try { mkdirSync(lock); } catch { throw new Error("Another development operation is active. Inspect the job instead of removing its lock."); }
  try {
    preflight();
    const job = state();
    if (command === "start") {
      if (job) throw new Error(`Finish the active ${job.branch} job before starting another.`);
      const candidate = path.join(root, value);
      if (existsSync(candidate)) throw new Error("The job directory already exists; choose a different slug.");
      localGit("fetch", "--no-tags", "origin", `refs/heads/main:${baseRef}`);
      const base = localGit("rev-parse", baseRef), branch = `topbot-dev/${value}`;
      if (!sha.test(base)) throw new Error("GitHub main did not resolve to a commit.");
      localGit("worktree", "add", "-b", branch, candidate, base);
      const created = { slug: value, path: candidate, branch, base };
      atomicJson(stateFile, created);
      return { ...created, resources: resources() };
    }
    const checked = review(job);
    if (checked.dirty) throw new Error("The development worktree still has uncommitted changes.");
    if (command === "finish") {
      const archived = path.join(home, `${job.slug}.json`);
      if (existsSync(archived)) throw new Error("A job with this slug was already archived.");
      renameSync(stateFile, archived);
      return { archived, worktreeRetained: job.path };
    }
    if (checked.blocked.length || !checked.files.length || checked.head === job.base || !sha.test(checked.head)) throw new Error("Draft blocked: inspect review for unsupported paths, secrets, or an empty diff.");
    git(job.path, ["diff", "--check", job.base, "--"]);
    const github = connect(repoRoot);
    const identity = await github("/user");
    if (identity.login !== "topway-ai") throw new Error("GitHub selected an account other than topway-ai; nothing was published.");
    git(job.path, ["push", "origin", `${checked.head}:refs/heads/${job.branch}`]);
    const query = new URLSearchParams({ head: `topway-ai:${job.branch}`, base: "main", state: "open" });
    const pullPath = `/repos/${repo}/pulls`;
    const current = (await github(`${pullPath}?${query}`))[0];
    const result = current ?? await github(pullPath, { base: "main", head: job.branch, draft: true,
      title: job.slug.replaceAll("-", " "),
      body: `Prepared from \`${job.base}\` for review. No release was requested.\n\n${checked.ownerReview.length ? "**Independent owner review requested:** this change touches protected development, update or security paths." : "Review the diff and test evidence before marking the draft ready."}` });
    if (!result.draft || result.head?.sha !== checked.head || !Number.isSafeInteger(result.number) || result.html_url !== `https://github.com/${repo}/pull/${result.number}`) {
      throw new Error("GitHub did not confirm a draft for the reviewed commit. Do not authorize release.");
    }
    return { draft: result.html_url, head: checked.head, ownerReview: checked.ownerReview, release: "not requested" };
  } finally { rmdirSync(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { os.setPriority(0, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch {}
  try { console.log(JSON.stringify(await runDevelopment(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
