# Preparing and publishing v1

The final combined implementation is the release candidate, not either earlier PR
in isolation. `CHANGELOG.md` is the release-note source of truth. This procedure
does not authorize a version change, tag, dispatch, or publication by itself.
CI run `38930587069` failed the iOS two-sided and swipeable suites. It is not
release evidence. Historical runs and local/offline checks cannot replace a
successful run of the final prepared source or physical acceptance.

## Prepare an unpublished exact version

1. Finish the combined implementation and independent review. Local draft metadata
   may be prepared while fixes are in progress, but final acceptance must use the
   exact prepared source/version, not the earlier 0.1.12 working tree. The current
   local draft is `1.0.0-rc.0`, unpublished and not release-approved. Subsequent
   candidates use an explicit `1.0.0-rc.N`, or stable `1.0.0`; never use
   `npm version prerelease` to infer v1.
2. In a separately reviewed preparation change, use
   `npm version 1.0.0-rc.0 --no-git-tag-version --ignore-scripts` (or the approved
   exact version; do not repeat if it is already prepared).
   Commit package and lockfile identity together with finalized release notes
   under exactly `## 1.0.0-rc.0 - YYYY-MM-DD`. Retain breaking API, migration,
   platform and appearance notes. Leave `Unreleased` for subsequent changes.
3. Merge the preparation to `main`. This commit is the source SHA to test and
   publish. Preparation is not publication and creates no release tag. The
   publishing workflow never bumps versions or commits source changes.
4. Run full CI twice as two distinct fresh `workflow_dispatch` runs on this
   exact `main` SHA with both mobile suites enabled. Both runs must completely
   succeed on attempt 1. A failed-jobs rerun is not the second independent pass.
   This repeats the historically failing iOS suites without changing assertions,
   retries, the 120-second case deadlines, or the 45-minute mobile job deadlines.

RC and stable preparation each change source identity. Evidence for an RC does
not authorize publishing a subsequently bumped stable package. Repeat full
acceptance on the stable source. If `main` moves before publication, prepare and
test the intended current revision again; never rewrite evidence to match it.

## Inconclusive host runs

Each iOS shard writes `ios-evidence/host-health.json`. It compares the simulator log
with the NDJSON results in `ios-results/`. Each failure has a window: a failed test
from its start to its result, a failed hook, or a failed warm-up. A test without a
result fails, and its window ends at the next record. A gesture counts in the window
that contains its start. The `e2e-ios` job summary
shows the gate checks and one host class for each shard. The gate checks column
uses the same checks as the gate for that shard: the step outcomes, the warm-up
and the full case inventory. It lists each condition that fails.

- `host trouble`: the gate rejects the shard only for failed cases, and the window
  of each failed case contains at least one gesture that went to latent system
  gesture destinations of the app scene. The simulator sent these gestures to
  SpringBoard first, and the app did not get them. A failed Maestro step or warm-up,
  a skipped, pending or unfinished case, a failed hook, a failed worker or a missing
  case is a real failure, and the shard is never `host trouble`.
- `host mixed`: some failure windows contain latent-routed gestures, and other
  failure windows do not, or the gate also rejects the shard for another reason.
  The failures without them, and the other rejections, are real failures.
- `host healthy`: no failure window contains a latent-routed gesture, or the shard
  has no failure. A latent-routed gesture during a passed warm-up or test does not count.
- `host unknown`: the shard has no usable simulator log, or it has latent-routed
  gestures and no test results.

The summary shows the latent-routed gestures in failure windows and in total.
The host class never changes the `e2e-ios` result. A run with a failed case fails.

1. If each failed shard of a failed run shows `host trouble`, the run is
   "inconclusive (host)". It is not release evidence. One failure without a
   latent-routed gesture in its window makes the run a real failure.
2. Never retry individual tests or failed jobs.
3. Dispatch a fresh full run only after an inconclusive (host) run.
4. Release evidence is a fully green full run.

## Evidence interface

[The readiness gate](https://github.com/chocky335/react-native-swipeable-actions/blob/main/scripts/release-readiness.mjs) retrieves evidence directly from GitHub for the
two supplied run IDs. Arbitrary local JSON pass receipts are not a publish input.
Both runs must be successful [CI workflow](https://github.com/chocky335/react-native-swipeable-actions/blob/main/.github/workflows/ci.yml) executions in this
repository with the exact source SHA and these successful jobs:

- `lint`, `test`, `package`, `build-ios`, `e2e-android`, `ios-plan`
- `iOS / performance`, `iOS / rtl`, `iOS / swipe-back`, `iOS / swipeable`, `iOS / two-sided`,
  `e2e-ios`

Any additional unsuccessful, duplicate, missing, skipped or unfinished job also
blocks publication. Each mobile job must have a successful `Run E2E tests` step,
and swipeable must execute `Run Maestro seekbar regression test` successfully.

The package artifact is `npm-package-<full SHA>` **within each supplied run**.
It contains `package-artifact.json` with `sourceSha`, `cleanSource: true`,
`version`, `integrity`, `filename`, and `files`, plus the actual tarball. Both
runs must test identical tarball bytes. The gate checks SHA-512 integrity and
the package name/version inside the tarball. Native release builders consume
this artifact in their clean consumer builds; publishing uses that same tarball,
not a new local build or pack.

iOS uses the existing `ios-plan-<sha>-<run>-1` and
`ios-shard-<sha>-<run>-1-<shard>` artifacts. The gate rediscovers the maintained
inventory from the prepared checkout, compares source hashes and case identities,
then validates raw NDJSON, worker completion, receipts, zero retries/skips,
all 62 cases and Maestro. Records must belong to the run's time interval.
Android uses the actual `e2e-android` job log: five completed spec workers, the
complete WDIO summary and every passing case title (including duplicate counts) are required.
A success badge, hand-entered count or summary without case output cannot pass.
Missing/expired artifacts or logs and changed reporter formats fail closed.
Recycling, detach and RTL remain mandatory in this same-source 62-case E2E
inventory on both platforms, in both runs. They are automated evidence requirements,
not extra physical smoke confirmations; removing their manual keys does not remove
any automated cases, assertions or required jobs.

## Explicit physical acceptance

A repository admin or maintainer must record a JSON issue comment after testing
the exact prepared source/package on a physical iPhone. Supply that comment's
numeric ID, not an issue ID, to the workflow. Simulator, unit, parser and harness
passes cannot create or imply this acceptance. Do not paste a passing template
without performing the checks. The required JSON fields are:

- `schemaVersion`: `1`; `verdict`: `"accepted"`; `platform`: `"physical-ios"`
- `sourceSha`: full prepared SHA; `version`: exact prepared version
- `packageIntegrity`: the tested package report's SHA-512 integrity
- `device`: model (no serial/UDID); `os`: tested iOS version; `testedAt`: ISO timestamp
- `checks`: an object with each of the following keys explicitly set to `"passed"`

Keep the physical smoke short, with seven grouped confirmations:

- `defaultAppearance`: inspect the default row and action appearance.
- `physicalSwipesAndActions`: swipe both edges and tap the revealed actions.
- `autoHaptics`: feel Auto feedback, including repeated threshold crossings within
  one gesture to confirm feedback is not repeated.
- `hapticsOn`: feel explicitly enabled feedback.
- `hapticsOff`: confirm explicitly disabled feedback stays silent.
- `hapticSuppression`: confirm programmatic changes, cancellation and auto-close
  do not produce unintended feedback.
- `reduceMotion`: change Reduce Motion while the app is running and check its
  live effect on motion and Auto feedback.

The comment author must be a human with current admin/maintain permission, and
the acceptance comment must be **unedited**. Corrections require a new comment
and its new numeric ID, even if the original author makes the correction.
The gate resolves the REST comment's `node_id` through
[GitHub's global node lookup](https://docs.github.com/en/graphql/guides/using-global-node-ids)
and matches the returned comment ID, author and exact body. GitHub's
[IssueComment fields](https://docs.github.com/en/graphql/reference/issues#issuecomment)
must report `lastEditedAt: null`, `editor: null` and `includesCreatedEdit: false`.
Missing metadata, GraphQL errors and mismatched snapshots fail closed. REST's
`user` and `updated_at` alone do not establish who wrote the final body. The test
time must precede or equal comment creation. Keep unresolved observations out of
an accepted record; document them as blockers instead.

## Verify, then publish

Configure the GitHub `npm-release` environment with required human reviewers and
main-only deployment rules, and npm trusted publishing for this workflow. Retain
the reviewed `main` workflow as the authority. Dispatch **Publish to npm** from
the prepared `main` revision with `operation=verify`, full `source_sha`, exact
`version`, `ci_runs=ID1,ID2`, and `acceptance_comment=ID`. Verification does not tag
or publish. It saves a verified report and the tested tarball. The source package,
lockfile, changelog entry, tarball and eventual `v<version>` tag must agree.

After review, dispatch the [publish workflow](https://github.com/chocky335/react-native-swipeable-actions/blob/main/.github/workflows/publish.yml)
with `operation=publish` and the same inputs. The gate
fetches and validates the evidence again. It requires that npm does not already
contain the version, establishes the source tag **before** publication, and uses
`npm publish package.tgz --ignore-scripts --provenance`. RC versions go to `next`;
stable `1.0.0` goes to `latest`. No mobile tests are skipped and substituted by
this workflow: their complete successful CI evidence is a prerequisite.

The job queries remote `refs/heads/main` after environment approval, then again
immediately before creating a tag, pushing it and publishing the tested tarball.
Every query must return the exact prepared SHA. A queued run's `GITHUB_SHA` is
fixed at dispatch and cannot establish that `main` is still current. If `main`
advances during approval or evidence collection, publication stops. These checks
do not atomically lock the branch with npm publication: keep `main` stable during
the short mutation window. If it advances after the tag is pushed, the final check
blocks publication and the immutable tag must be retained for inspection.

If publication fails after tagging, retain the tag and inspect npm first. A retry
may use an existing tag only when it resolves to the exact tested SHA and the
version is still unpublished. An existing npm version blocks a retry, including
when a previous request succeeded but its response was lost. Never move a release
tag, overwrite published history, or silently reuse evidence after changing source.
Create GitHub Release notes from the exact changelog section after verifying npm
and tag identity. The workflow does not create GitHub Releases.

Offline gate regression command from a repository checkout:
`node --test scripts/release-readiness.test.mjs`.
The [regression suite](https://github.com/chocky335/react-native-swipeable-actions/blob/main/scripts/release-readiness.test.mjs)
uses synthetic evidence and mocked workflow git/npm commands. It tests rejection
logic and mutation boundaries; it is not mobile acceptance and never publishes.
