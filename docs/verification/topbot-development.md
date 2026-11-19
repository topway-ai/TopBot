# TopBot Development From Chat

The explicit trigger is `/topbot-development` or `TopBot development`.
The chat can check readiness, prepare a change
in a separate worktree, run focused checks and open a draft pull request.
It cannot merge, publish, install or edit the running application through this
controller. A draft can contain protected paths, but calls them out for owner
review. CodeGraph is optional and provides context, not publish authority.

## Local Setup

Keep `topbot-development.cmd`, `topbot-development.mjs` and `config.json` in
`%USERPROFILE%/.topbot-development`, outside every editing worktree. Configure
`checkout` as a local clone whose fetch and push remote is the pinned TopBot
repository. Set `worktrees` to an existing separate directory on a roomy disk.
The launcher uses the installed CodeGraph Node runtime or a Node on PATH.
Install the two skill files in the app's private `skills/topbot-development`
directory to enable it before the next packaged version. Do not overwrite
existing skills or expose that data directory in a commit.

`doctor` is read-only. `start` requires at least 3 GiB of available RAM and
6 GiB of free staging disk and allows one active worktree. `finish` archives
the job without removing files. Keep local checks focused and serial; package
Windows on GitHub. The threshold is a preflight, not a hard OS resource limit.

`draft` depends on authorized Windows Git Credential Manager access for
`topway-ai`. The controller uses it only for the pinned repository, verifies
the GitHub account and exact draft SHA, and never writes or prints its token.
It has no release operation. That is a restriction of this controller, not
a sandbox for a bot granted unrestricted shell or browser access. Enforce
repository permissions and protected paths separately; never give the routine
development bot unrestricted owner credentials or automatic approval.

## Release From Chat

In an updated Windows TopBot desktop, send `/topbot-release 123` as a direct
chat message after the PR's development checks pass. The preview is read-only
and shows the PR, exact head and main commits, version, and the check run.
Review that candidate, then send the displayed `/topbot-publish CODE` in the
same chat within five minutes. Only the last preview is active; restarting
TopBot invalidates it. The command runs on the server without calling the AI.

One confirmation can mark a draft ready, merge the approved head, and queue
**TopBot Windows Update** for the verified merge SHA. The first confirmation
consumes the approval. If the PR or CI result changes, start over. If a network
error follows a GitHub write, check the PR and Actions links before retrying:
TopBot does not repeat writes with unknown outcomes. The Actions job packages
and verifies Windows in CI; a queued build is not a published release.

Chat release currently allows only Markdown under `docs`, source CSS,
translations, and a version-only `package.json` change. The version must
advance beyond main and the installed app. Other changes (including the
initial rollout of this release feature) require independent maintainer review.
For those, the repository owner can dispatch the release workflow separately
after merging, using `publish: true` and the reviewed main SHA.

The desktop verifies the `topway-ai` GitHub identity with the existing Windows
Git Credential Manager and accepts commands only through the authenticated
local desktop while bots are idle. If the Windows desktop does not inherit Git
on PATH, set `gitExecutable` to the absolute Git executable in the existing
development `config.json`. Keep that configuration outside any worktree.
This is not protection against other
software with unrestricted access to that Windows user or desktop. Keep the
development bot's shell and computer permissions scoped; never enter tokens in
chat or grant broad access to the release account.

The existing [update and rollback flow](topbot-updates.md) takes over after a
new compatible release is available. Opening or merging a PR alone does not
create a release.

## Verification

```sh
node --test --test-concurrency=1 scripts/topbot-development.node-test.mjs
```

The test uses real disposable Git worktrees and a synthetic GitHub API. It
proves original working files are untouched, private files and unsafe branches
are blocked, success creates an exact draft, repeated submission reuses it,
and no release request exists. It never uses a real GitHub credential.
