import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeFiles, gitAt, runDevelopment } from "./topbot-development.mjs";

const GiB = 1024 ** 3;
const origin = "https://github.com/topway-ai/TopBot.git";

function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "topbot-dev-test-")));
  t.after(() => {
    assert.equal(path.basename(base).startsWith("topbot-dev-test-"), true);
    assert.equal(path.dirname(base), realpathSync(os.tmpdir()));
    rmSync(base, { recursive: true, force: true });
  });
  const checkout = path.join(base, "checkout"), worktrees = path.join(base, "worktrees"), home = path.join(base, "config");
  for (const directory of [checkout, worktrees, home]) mkdirSync(directory);
  const git = (cwd, ...args) => gitAt(cwd, args).trim();
  const commit = (cwd, message) => git(cwd,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m",message);
  git(checkout, "init", "-b", "main");
  git(checkout, "config", "core.autocrlf", "false");
  git(checkout, "remote", "add", "origin", origin);
  writeFileSync(path.join(checkout, "README.md"), "Versioned base.\n");
  git(checkout, "add", "README.md");
  commit(checkout, "Base");
  const head = git(checkout, "rev-parse", "HEAD");
  git(checkout, "update-ref", "refs/remotes/origin/main", head);
  writeFileSync(path.join(checkout, "README.md"), "Unsaved user work.\n");
  writeFileSync(path.join(home,"config.json"), JSON.stringify({ checkout, worktrees }));
  const calls = [], api = [];
  let pushed, existing, login = "topway-ai";
  const options = { home, availableRam: () => 8 * GiB, disk: () => ({ bavail: 20, bsize: GiB }), git: (directory, args) => {
    calls.push(args);
    if (args[0] === "fetch") return "";
    if (args[0] === "push") { pushed = args[2].split(":")[0]; return ""; }
    return gitAt(directory, args);
  }, connect: () => async (route, payload) => {
    api.push({ route, payload });
    if (route === "/user") return { login };
    if (!payload) return existing ? [existing] : [];
    existing = { number: 7, head: { sha: pushed }, draft: true, html_url: "https://github.com/topway-ai/TopBot/pull/7" };
    return existing;
  } };
  return { checkout, worktrees, home, head, calls, api, git, commit, options, setLogin: value => { login = value; },
    run: (...args) => runDevelopment(args, options) };
}

test("isolates a draft worktree, leaves original dirty source intact and only pushes the committed job branch", async t => {
  const f = fixture(t);
  assert.equal((await f.run("doctor")).active, null);
  const job = await f.run("start","update-check");
  assert.equal(job.base, f.head);
  assert.equal(readFileSync(path.join(job.path,"README.md"),"utf8"), "Versioned base.\n");
  assert.equal(readFileSync(path.join(f.checkout,"README.md"),"utf8"), "Unsaved user work.\n");
  await assert.rejects(f.run("start","second-job"), /Finish the active/);
  writeFileSync(path.join(job.path,"README.md"), "Reviewed update.\n");
  await assert.rejects(f.run("draft"), /uncommitted/);
  f.git(job.path,"add","README.md");
  f.commit(job.path,"Prepare update tests");
  const review = await f.run("review");
  assert.deepEqual(review.files, ["README.md"]);
  assert.deepEqual(review.blocked, []);
  f.setLogin("different-account");
  await assert.rejects(f.run("draft"), /other than topway-ai/);
  assert.equal(f.calls.some(a => a[0] === "push"), false);
  f.setLogin("topway-ai");
  const draft = await f.run("draft");
  assert.equal(draft.head, review.head);
  assert.deepEqual(f.calls.find(a => a[0] === "push"), ["push", "origin", `${review.head}:refs/heads/topbot-dev/update-check`]);
  const created = f.api.find(entry => entry.payload);
  assert.deepEqual([created.payload.head,created.payload.base,created.payload.draft], ["topbot-dev/update-check","main",true]);
  assert.equal((await f.run("draft")).draft, draft.draft);
  assert.equal(f.api.filter(entry => entry.payload).length, 1);
  const archived = await f.run("finish");
  assert.equal(archived.worktreeRetained, job.path);
  assert.equal((await f.run("doctor")).active, null);
  assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), f.head);
});

test("fails closed for low resources, hostile slugs, private files and unsupported release commands", async t => {
  const f = fixture(t);
  await assert.rejects(runDevelopment(["start","test"], { ...f.options, availableRam: () => GiB }), /3 GiB/);
  await assert.rejects(f.run("start","../escape"), /Use doctor/);
  await assert.rejects(f.run("publish"), /Use doctor/);
  const job = await f.run("start","private-file");
  writeFileSync(path.join(job.path,"secret.json"), "{}\n");
  f.git(job.path,"add","secret.json");
  f.commit(job.path,"Unexpected private data");
  assert.equal((await f.run("review")).blocked[0]?.file, "secret.json");
  await assert.rejects(f.run("draft"), /unsupported paths/);
  assert.equal(f.api.length, 0);
});

test("identifies release-owner review paths and rejects likely keys and local profiles", async t => {
  const f = fixture(t);
  const files = [".github/workflows/release.yml","electron/topbot-release.mjs","scripts/topbot-development.cmd","docs/report.md","../escape.md"];
  const result = analyzeFiles(f.checkout, files, `+apiKey: ${"ghp_" + "x".repeat(40)}`);
  assert.deepEqual(result.ownerReview, files.slice(0,3));
  assert.equal(result.blocked.length, 2);
  assert.equal(result.blocked[0].file, "../escape.md");
});
