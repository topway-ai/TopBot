# TopBot Development From Chat

The explicit trigger is `/topbot-development` or `TopBot development`.
The chat can check readiness, prepare a change
in a separate worktree, run focused checks and open a draft pull request.
It cannot merge, publish, install or edit the running application through this
controller. Source or workflow edits stay local for independent review before
any same-repository push. CodeGraph provides context, not publish authority.

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
For eligible edits, it reconstructs the reviewed tree from the remote base
and inspected file objects, and pushes a one-commit snapshot. Original
development commits, messages and intermediate files are not sent.
Published job branches are immutable. For a revision, start a new job with
a new slug. A retry may report the same matching draft, not overwrite it.
It has no release operation. That is a restriction of this controller, not
a sandbox for a bot granted unrestricted shell or browser access. Enforce
repository permissions and protected paths separately; never give the routine
development bot unrestricted owner credentials or automatic approval.

## Release From Chat

In an updated Windows TopBot desktop, send `/topbot-release 123` as a direct
chat message after GitHub has merged an independently approved PR and the
merged commit has passed full CI. The preview is read-only and shows the PR,
exact merged commit, version, and the full CI run.
Review that candidate, then send the displayed `/topbot-publish CODE` in the
same chat within five minutes. Only the last preview is active; restarting
TopBot invalidates it. The command runs on the server without calling the AI.

One confirmation can queue **TopBot Windows Update** for that SHA. The
desktop cannot merge, push to a branch or create a tag. GitHub must enforce
PR review, stale approval dismissal, last-push approval by another person,
resolved discussions, and a strict GitHub Actions `CI` check on `main`.
The first confirmation consumes its code. If the review, CI attempt or
main commit changes, start over. If a network
error follows a GitHub write, check the PR and Actions links before retrying:
TopBot does not repeat writes with unknown outcomes. The Actions job packages
and verifies Windows in CI; a queued build is not a published release.

The automatic lane accepts plain non-executable notes named
`topbot-release-notes/<lowercase-slug>.txt` and a version-only
`package.json` change. Code, styles, rendered documentation, translations
and CI inputs are not treated as inert files. The version must
advance beyond the prior main version and the installed app. Other changes (including the
initial rollout of this release feature) require independent maintainer review.
For those, the repository owner can dispatch the release workflow separately
after merging, using `publish: true` and the reviewed main SHA.

Both dispatch paths require the same evidence. The merge commit's tree
must match the reviewed PR head. A human with repository write permission,
other than the PR author or publishing owner, must approve that exact head
before merge. After merging, run the full **CI** workflow from the Actions
tab on `main` (the manual event uses the full matrix). A selective PR or
push run alone does not qualify. The publish job independently reads the
approval and full CI for the exact commit before creating the tag, and
rechecks both before publishing the draft.

Enable GitHub Immutable Releases for this repository before testing a
production dispatch. The publish job checks that the setting is enabled
and verifies the published release is immutable. Give the policy check its
own repository-scoped read-only credential via `TOPBOT_RELEASE_POLICY_TOKEN`
in the main-only `topbot-windows-release` environment. It
needs read access to Administration, Actions, Contents and Pull requests.
The policy credential is only used for GitHub GET requests, never for tags
or uploads. Do not use a broad developer or owner token for this secret.
Changing the pinned main ruleset requires a newly reviewed policy revision.
Limit release writers: drafts remain mutable until GitHub publishes them.

Before either release path can publish, configure an active repository **tag**
ruleset covering `refs/tags/v*` (no exclusions or bypass actors). Restrict
updates and deletions, not creation. The owner must be able to read the full
rule, including its bypass list. Chat reads it at preview and again at
confirmation and passes its ID and revision to the workflow. A missing rule
is a stop condition, not permission to publish an unprotected tag. For a
manual dispatch use the verified `ID@updated_at` as `reviewed_tag_ruleset`.
Creating repository rules is an explicit owner operation; the app does not do it.
If a publication stops after reserving its tag, inspect the tag and draft
before choosing a new version. Retries do not reclaim a pre-existing tag.
Tag protection does not sign release binaries or remove a repository
administrator's ability to change release policy.
The upstream multi-platform release, npm publishing, legacy mirror,
GHCR and broker deployment writers are disabled for this fork. Do not
grant other automations release write access.
These guards apply to workflow revisions containing them, not historical runs.
Before the first production dispatch, review existing Actions runs and other
write credentials; do not rerun old release workflows.

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
