import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { gitAt, runDevelopment } from "./topbot-development.mjs";

const GiB = 1024 ** 3;
const origin = "https://github.com/topway-ai/TopBot.git";
const note = "topbot-release-notes/update.txt";
const manifest = '{\n  "name": "test",\n  "version": "1.2.3-topbot.1",\n  "scripts": {}\n}\n';
const bump = manifest.replace("topbot.1", "topbot.2");
const git = (cwd, ...args) => gitAt(cwd, args).trim();
const inventory = cwd => git(cwd, "cat-file", "--batch-all-objects", "--batch-check=%(objectname)").split(/\r?\n/).sort();
const commit = (cwd, message) => git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "-m", message);
function write(cwd, file, content) {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), content);
}
function save(cwd, message) {
  git(cwd, "add", "-A");
  commit(cwd, message);
  return git(cwd, "rev-parse", "HEAD");
}

function fixture(t) {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), "topbot-dev-test-")));
  t.after(() => {
    assert.equal(path.basename(base).startsWith("topbot-dev-test-"), true);
    assert.equal(path.dirname(base), realpathSync(os.tmpdir()));
    rmSync(base, { recursive: true, force: true });
  });
  const checkout = path.join(base, "checkout"), worktrees = path.join(base, "worktrees"), home = path.join(base, "config");
  const remote = path.join(base, "remote.git"), url = pathToFileURL(remote).href;
  for (const directory of [checkout, worktrees, home, remote]) mkdirSync(directory);
  git(remote, "init", "--bare", "--template=", "-b", "main");
  git(remote, "config", "uploadpack.allowFilter", "true");
  git(checkout, "init", "--template=", "-b", "main");
  git(checkout, "config", "core.autocrlf", "false");
  git(checkout, "config", "core.symlinks", "false");
  git(checkout, "config", "core.filemode", "false");
  git(checkout, "remote", "add", "origin", origin);
  write(checkout, "README.md", "Versioned base.\n");
  write(checkout, "package.json", manifest);
  const head = save(checkout, "Base");
  git(remote, "fetch", "--no-tags", pathToFileURL(checkout).href, "refs/heads/main:refs/heads/main");
  write(checkout, "README.md", "Unsaved user work.\n");
  write(home, "config.json", JSON.stringify({ checkout, worktrees }));

  const pushes = [], api = [];
  const control = { login: "topway-ai", pulls: [] };
  let branchRef;
  const options = { home, availableRam: () => 8 * GiB, disk: () => ({ bavail: 20, bsize: GiB }), git: (cwd, args, io) => {
    if (["fetch", "push", "ls-remote"].includes(args[0])) {
      assert.ok(args.includes(origin) || args.includes("origin"), "only the fixture transport is permitted");
      const local = args.map(a => a === origin || a === "origin" ? url : a);
      if (args[0] === "push") {
        pushes.push(args);
        control.beforePush?.(cwd, local);
      }
      const out = gitAt(cwd, local, io);
      if (args[0] === "push") {
        branchRef = args.at(-1).split(":")[1];
        assert.ok(!inventory(cwd).includes(git(remote, "rev-parse", "main:README.md")), "builder did not hydrate unrelated main blobs");
        control.afterPush?.();
      }
      return out;
    }
    return gitAt(cwd, args, io);
  }, connect: () => async (route, payload) => {
    api.push({ route, payload });
    if (route === "/user") { control.onIdentity?.(); return { login: control.login }; }
    const url = new URL(route, "https://api.github.com");
    assert.equal(url.pathname, "/repos/topway-ai/TopBot/pulls");
    if (payload) {
      if (control.failCreate) throw new Error("PR creation failed");
      const repository = { full_name: "topway-ai/TopBot" };
      const pr = { id: 107, number: 7, html_url: "https://github.com/topway-ai/TopBot/pull/7", state: "open", draft: payload.draft,
        base: { ref: payload.base, sha: git(remote, "rev-parse", payload.base), repo: repository },
        head: { ref: payload.head, sha: git(remote, "rev-parse", branchRef), repo: repository } };
      control.pulls.push(pr);
      return structuredClone(pr);
    }
    const params = url.searchParams;
    assert.equal(params.get("state"), "open");
    assert.equal(params.has("base"), false, "PR discovery must include other targets");
    assert.ok(Number(params.get("per_page") ?? 30) >= 2);
    return structuredClone(control.pulls.filter(pr => pr.state === "open" && `topway-ai:${pr.head.ref}` === params.get("head"))
      .slice(0, Number(params.get("per_page") ?? 30)));
  } };
  return { checkout, home, head, remote, pushes, api, control, options, run: (...args) => runDevelopment(args, options) };
}

test("bare remote receives only a single approved snapshot, never source history, tags or metadata", async t => {
  const f = fixture(t);
  const initial = inventory(f.remote);
  assert.equal((await f.run("doctor")).active, null);
  const job = await f.run("start", "update-check");
  assert.equal(job.base, f.head);
  assert.equal(readFileSync(path.join(f.checkout, "README.md"), "utf8"), "Unsaved user work.\n");
  await assert.rejects(f.run("start", "second-job"), /Finish the active/);
  write(job.path, "local-only.json", '"Private intermediate content"\n');
  const hidden = save(job.path, "Private intermediate subject");
  git(job.path, "rm", "local-only.json");
  write(job.path, note, "Caf\u00e9 release.\n");
  write(job.path, "package.json", bump);
  await assert.rejects(f.run("draft"), /uncommitted/);
  const source = save(job.path, "Private final subject");
  git(job.path, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "tag", "-a", "local-tag", "-m", "Private annotation", job.base);
  git(job.path, "config", "push.followTags", "true");
  const review = await f.run("review");
  assert.deepEqual(review.files, ["package.json", note]);
  assert.deepEqual(review.blocked, []);
  assert.equal(review.head, source);
  f.control.login = "different-account";
  await assert.rejects(f.run("draft"), /other than topway-ai/);
  assert.equal(f.pushes.length, 0);
  f.control.login = "topway-ai";
  // Move HEAD after review, before publication. Neither the new blob nor its commit may escape.
  f.control.onIdentity = () => {
    write(job.path, "outside-review.txt", "Later private content\n");
    save(job.path, "Moved after review");
  };
  const draft = await f.run("draft");
  const ref = `refs/heads/${job.branch}`;
  assert.notEqual(draft.head, source);
  assert.equal(git(f.remote, "rev-parse", ref), draft.head);
  assert.equal(git(f.remote, "rev-list", "--parents", "-1", ref), `${draft.head} ${job.base}`);
  const tree = git(job.path, "rev-parse", `${source}^{tree}`);
  const time = git(f.remote, "show", "-s", "--format=%ct", job.base);
  const identity = `TopBot Development <topbot-development@users.noreply.github.com> ${time} +0000`;
  assert.equal(gitAt(f.remote, ["cat-file", "commit", ref]), `tree ${tree}\nparent ${job.base}\nauthor ${identity}\ncommitter ${identity}\n\nReviewed TopBot draft\n`);
  assert.equal(gitAt(f.remote, ["show", `${ref}:${note}`]), "Caf\u00e9 release.\n");
  assert.equal(gitAt(f.remote, ["show", `${ref}:package.json`]), bump);
  const reachable = git(f.remote, "rev-list", "--objects", "--no-object-names", ref, `^${job.base}`).split(/\r?\n/).sort();
  const received = inventory(f.remote).filter(id => !initial.includes(id));
  assert.deepEqual(received, reachable, "no additional, even unreachable, objects transferred");
  for (const id of [hidden, source, git(job.path, "rev-parse", `${hidden}:local-only.json`), git(job.path, "rev-parse", "HEAD:outside-review.txt")]) {
    assert.ok(!received.includes(id));
  }
  assert.equal(git(f.remote, "for-each-ref", "--format=%(refname)"), `refs/heads/main\n${ref}`);
  const created = f.api.find(entry => entry.payload).payload;
  assert.deepEqual([created.head, created.base, created.draft], [job.branch, "main", true]);
  assert.equal((await f.run("finish")).worktreeRetained, job.path);
  assert.equal((await f.run("doctor")).active, null);
  await assert.rejects(f.run("start", job.slug), /already used/);
  assert.equal(git(f.checkout, "rev-parse", "HEAD"), job.base);
});

test("protected, executable, non-UTF-8 and secret-bearing changes fail before a remote write", async t => {
  const f = fixture(t);
  const job = await f.run("start", "blocked");
  const before = inventory(f.remote);
  const bad = [".github/workflows/check.yml", "docs/guide.md", "apps/docs/page.mdx", "pnpm-lock.yaml", ".gitattributes",
    "scripts/topbot-development.mjs", "src/build.ts", "topbot-release-notes/guide.md", "topbot-release-notes/nested/a.txt"];
  for (const file of bad) write(job.path, file, "fixture\n");
  write(job.path, note, "+++ghp_" + "x".repeat(40) + "\n");
  write(job.path, "topbot-release-notes/binary.txt", Buffer.from([0x61, 0, 0x62]));
  write(job.path, "topbot-release-notes/invalid.txt", Buffer.from([0xff]));
  write(job.path, "topbot-release-notes/machine.txt", "C:\\Users\\private\\profile\n");
  write(job.path, "topbot-release-notes/run.txt", "example\n");
  write(job.path, "topbot-release-notes/link.txt", "../../package.json");
  write(job.path, "package.json", bump.replace('"scripts": {}', '"scripts": {"test":"changed"}'));
  git(job.path, "rm", "README.md");
  git(job.path, "add", "-A");
  git(job.path, "update-index", "--chmod=+x", "topbot-release-notes/run.txt");
  const link = "topbot-release-notes/link.txt";
  git(job.path, "update-index", "--cacheinfo", `120000,${git(job.path, "rev-parse", `:${link}`)},${link}`);
  commit(job.path, "Blocked changes");
  git(job.path, "update-index", "--assume-unchanged", note);
  write(job.path, note, "The working copy looks safe.\n");
  const checked = await f.run("review");
  assert.equal(checked.dirty, false);
  assert.deepEqual(checked.blocked.map(b => b.file).sort(), [...bad, note, link, "package.json", "README.md",
    ...["binary", "invalid", "machine", "run"].map(n => `topbot-release-notes/${n}.txt`)].sort());
  await assert.rejects(f.run("draft"), /Draft blocked/);
  assert.equal(f.api.length, 0);
  assert.equal(f.pushes.length, 0);
  assert.deepEqual(inventory(f.remote), before);
  assert.equal(git(f.remote, "for-each-ref", "--format=%(refname)"), "refs/heads/main");
});

test("package changes must be byte-exact and use a supported literal version", async t => {
  const f = fixture(t);
  const job = await f.run("start", "version-check");
  for (const changed of [bump + "\n", bump.replace("topbot.2", "preview.1"), bump.replace("1.2.3", "01.2.3"),
    bump.replace('"scripts": {}', '"version":"1.2.4","scripts": {}'), bump.replace('"name"', '"alias"')]) {
    write(job.path, "package.json", changed);
    save(job.path, "Rejected version change");
    await assert.rejects(f.run("draft"), /Draft blocked/);
  }
  assert.equal(f.api.length, 0);
  assert.equal(f.pushes.length, 0);
  write(job.path, "package.json", manifest.replace("1.2.3-topbot.1", "1.2.4"));
  save(job.path, "Stable numeric version");
  const { head } = await f.run("draft");
  assert.equal(git(f.remote, "rev-list", "--count", `${job.base}..${head}`), "1");
});

test("only the unchanged snapshot and original sole open draft are idempotent; retries never write", async t => {
  const f = fixture(t);
  const job = await f.run("start", "updates");
  const ref = `refs/heads/${job.branch}`;
  write(job.path, note, "First\n");
  save(job.path, "First source");
  const first = await f.run("draft");
  const [original] = f.control.pulls;
  const stateFile = path.join(f.home, "active.json");
  const receipt = readFileSync(stateFile, "utf8");
  assert.deepEqual(JSON.parse(receipt).pull, { id: original.id, number: original.number });
  const objects = inventory(f.remote);
  const noWrites = () => {
    assert.equal(f.pushes.length, 1);
    assert.equal(f.api.filter(e => e.payload).length, 1);
    assert.equal(readFileSync(stateFile, "utf8"), receipt);
  };
  assert.deepEqual(await f.run("draft"), first);
  noWrites();
  for (const pulls of [
    [{ ...original, base: { ...original.base, ref: "release" } }],
    [{ ...original, draft: false }],
    [{ ...original, id: original.id + 1 }],
    [{ ...original, number: 8, html_url: "https://github.com/topway-ai/TopBot/pull/8" }],
    [{ ...original, head: { ...original.head, sha: job.base } }],
    [{ ...original, head: { ...original.head, repo: { full_name: "example/TopBot" } } }],
    [{ ...original, state: "closed" }],
    [original, { ...original, id: 108, number: 8, base: { ...original.base, ref: "release" } }],
  ]) {
    f.control.pulls = pulls;
    await assert.rejects(f.run("draft"), /manual recovery/);
    noWrites();
  }
  f.control.pulls = [original];
  write(job.path, note, "Second\n");
  save(job.path, "Second source");
  await assert.rejects(f.run("draft"), /immutable snapshot/);
  noWrites();
  assert.equal(git(f.remote, "rev-parse", ref), first.head);
  assert.deepEqual(inventory(f.remote), objects);
  write(job.path, note, "First\n");
  save(job.path, "Identical tree, different local commit");
  assert.deepEqual(await f.run("draft"), first);
  git(f.remote, "update-ref", ref, job.base, first.head);
  await assert.rejects(f.run("draft"), /head is missing or changed/);
  git(f.remote, "update-ref", "-d", ref, job.base);
  await assert.rejects(f.run("draft"), /head is missing or changed/);
  noWrites();
});

test("first publication requires an absent branch and a base independently fetched from main", async t => {
  const f = fixture(t);
  const job = await f.run("start", "collision");
  const ref = `refs/heads/${job.branch}`;
  const first = await f.run("review");
  assert.deepEqual(first.files, []);
  await assert.rejects(f.run("draft"), /empty diff/);
  write(job.path, note, "Note\n");
  const local = save(job.path, "Local only");
  const before = inventory(f.remote);
  git(f.remote, "update-ref", ref, job.base);
  await assert.rejects(f.run("draft"), /branch already exists/);
  assert.equal(f.pushes.length, 0);
  git(f.remote, "update-ref", "-d", ref, job.base);
  write(job.path, note, "Changed\n");
  save(job.path, "Descendant of untrusted base");
  write(f.home, "active.json", JSON.stringify({ ...job, base: local }));
  await assert.rejects(f.run("draft"), /not current GitHub main/);
  write(f.home, "active.json", JSON.stringify(job));
  f.control.beforePush = () => git(f.remote, "update-ref", ref, job.base);
  await assert.rejects(f.run("draft"), /git push failed/);
  assert.deepEqual(inventory(f.remote), before);
  f.control.beforePush = undefined;
  await assert.rejects(f.run("draft"), /manual recovery/);
  assert.equal(f.pushes.length, 1);
  assert.equal(git(f.remote, "rev-parse", ref), job.base);
  assert.equal(f.api.filter(e => e.payload).length, 0);
});

test("a lost or incomplete publication cannot recreate the head or open a replacement PR", async t => {
  const f = fixture(t);
  const job = await f.run("start", "incomplete");
  const ref = `refs/heads/${job.branch}`;
  write(job.path, note, "First\n");
  save(job.path, "Local note");
  f.control.failCreate = true;
  await assert.rejects(f.run("draft"), /manual recovery required.*PR creation failed/);
  const pending = (await f.run("doctor")).active;
  assert.equal(git(f.remote, "rev-parse", ref), pending.published);
  assert.equal(pending.pull, undefined);
  f.control.failCreate = false;
  await assert.rejects(f.run("draft"), /no complete receipt; manual recovery/);
  git(f.remote, "update-ref", "-d", ref, pending.published);
  await assert.rejects(f.run("draft"), /no complete receipt; manual recovery/);
  // Legacy jobs stored just the snapshot SHA, not the identity of their original PR.
  write(f.home, "active.json", JSON.stringify({ ...job, published: pending.published }));
  await assert.rejects(f.run("draft"), /no complete receipt; manual recovery/);
  assert.equal(f.pushes.length, 1);
  assert.equal(f.api.filter(e => e.payload).length, 1);
});

test("never adopts an existing PR before or immediately after branch creation", async t => {
  const f = fixture(t);
  const job = await f.run("start", "claimed");
  write(job.path, note, "Note\n");
  save(job.path, "Note");
  const other = { state: "open", draft: false, base: { ref: "release" }, head: { ref: job.branch } };
  f.control.pulls.push(other);
  await assert.rejects(f.run("draft"), /open PR already uses this head/);
  assert.equal(f.pushes.length, 0);
  f.control.pulls = [];
  f.control.afterPush = () => f.control.pulls.push(other);
  await assert.rejects(f.run("draft"), /manual recovery required.*open PR appeared/);
  f.control.pulls = [];
  await assert.rejects(f.run("draft"), /manual recovery/);
  assert.equal(f.pushes.length, 1);
  assert.equal(f.api.filter(e => e.payload).length, 0);
});

test("a concurrent creator of the identical snapshot is not mistaken for a new branch", async t => {
  const f = fixture(t);
  const job = await f.run("start", "identical");
  write(job.path, note, "Note\n");
  save(job.path, "Note");
  f.control.beforePush = (stage, localArgs) => gitAt(stage, localArgs);
  await assert.rejects(f.run("draft"), /manual recovery required.*did not confirm creation/);
  await assert.rejects(f.run("draft"), /no complete receipt/);
  assert.equal(f.pushes.length, 1);
  assert.equal(f.api.filter(e => e.payload).length, 0);
});

test("fails closed for low resources, hostile slugs and unsupported release commands", async t => {
  const f = fixture(t);
  await assert.rejects(runDevelopment(["start","test"], { ...f.options, availableRam: () => GiB }), /3 GiB/);
  await assert.rejects(f.run("start","../escape"), /Use doctor/);
  await assert.rejects(f.run("publish"), /Use doctor/);
});
