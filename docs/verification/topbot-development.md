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

## Release

Keep the PR as a draft until its tests and diff have been reviewed. Changes to
release workflows, the updater, permission boundaries, or data migrations
need an independent maintainer review. After merging, confirm the exact
`main` SHA and a version higher than the installed app. The repository owner
can dispatch **TopBot Windows Update** on `main` with `publish: true` and that
SHA as `reviewed_sha`. A preview uses `publish: false`. Chat approval records
intent; GitHub still authenticates the separate release operator. No credentials
or application profile data belong in chat. The existing signed-in workstation
does not grant the chatbot permission to publish.

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
