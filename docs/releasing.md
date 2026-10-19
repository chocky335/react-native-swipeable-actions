# Preparing and publishing v1

The prepared `main` revision is the release candidate. `CHANGELOG.md` is the
release-note source of truth. This procedure does not authorize a version change,
tag, dispatch, or publication by itself. Historical runs and local or offline
checks cannot replace a successful run of the prepared source or physical
acceptance.

## Prepare an unpublished exact version

1. Finish the implementation and its independent review. Final acceptance must
   use the exact prepared source and version. Release candidates use an explicit
   `1.0.0-rc.N`, and the stable release uses `1.0.0`. Never use
   `npm version prerelease` to infer v1.
2. In a separately reviewed preparation change, use
   `npm version <version> --no-git-tag-version --ignore-scripts` with the approved
   exact version. Skip that command if `package.json` already has that version.
   Commit package and lockfile identity together with finalized release notes
   under exactly `## <version> - YYYY-MM-DD`. Retain breaking API, migration,
   platform and appearance notes. Leave `Unreleased` for subsequent changes.
3. Merge the preparation to `main`. This commit is the source SHA to test and
   publish. Preparation is not publication and creates no release tag. The
   publishing workflow never bumps versions or commits source changes.
4. Run full CI once as a fresh `workflow_dispatch` run on this exact `main` SHA
   with both mobile suites enabled. The run must completely succeed on attempt 1.
   A failed-jobs rerun is not release evidence. Do not change assertions, retries,
   the 120-second case deadlines, or the 45-minute mobile job deadlines.

RC and stable preparation each change source identity. Evidence for an RC does
not authorize publishing a subsequently bumped stable package. Repeat full
acceptance on the stable source. If `main` moves before publication, prepare and
test the intended current revision again; never rewrite evidence to match it.

## Dependency advisories

The published package has no runtime dependencies. Advisories in the lockfiles come
from development and test tooling (React Native, Expo, Appium, WebdriverIO).

Run the audit while you prepare the version (step 2), before the CI run in step 4. A
lockfile change after step 4 voids that run.

1. Run `npm audit --package-lock-only` in the repository root and in `e2e/`.
2. Update each critical advisory that has a fix inside its existing semver range.
3. If a critical advisory needs a tool upgrade (for example a new Appium release),
   record it in the release notes or an issue with the tool and the advisory. Do not
   run `npm audit fix --force`.

Known for 1.0.0-rc.0: `e2e/package-lock.json` has critical advisories inside the
Appium tree (`@appium/support`, `proxy-addr`, `shell-quote`). They affect only the
E2E test machines. They need an Appium upgrade, which is planned after 1.0.0.

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
  SpringBoard first, and the app did not get them. A Maestro step that a failed WDIO
  step skipped is part of the failed cases. The worker result is part of them only when
  it is one Mocha failure for each failed case, or when the worker ends directly after a
  failed last case and its worker-end record shows a quarantine that started in that
  case. A failed Maestro step or warm-up, a skipped, pending or unfinished case, a
  failed hook, a failed worker or a missing case is a real failure, and the shard is
  never `host trouble`.
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
one supplied run ID. Arbitrary local JSON pass receipts are not a publish input.
The run must be a successful [CI workflow](https://github.com/chocky335/react-native-swipeable-actions/blob/main/.github/workflows/ci.yml) execution in this
repository with the exact source SHA and these successful jobs:

- `lint`, `test`, `test-ios`, `package`, `build-ios`, `e2e-android`, `ios-plan`
- `iOS / performance`, `iOS / rtl`, `iOS / swipe-back`, `iOS / swipeable`, `iOS / two-sided`,
  `e2e-ios`

Any additional unsuccessful, duplicate, missing, skipped or unfinished job also
blocks publication. Each mobile job must have a successful `Run E2E tests` step,
and swipeable must execute `Run Maestro seekbar regression test` successfully.
`test-ios` must have a successful `Run Swift unit tests` step.

The package artifact is `npm-package-<full SHA>` **within the supplied run**.
It contains `package-artifact.json` with `sourceSha`, `cleanSource: true`,
`version`, `integrity`, `filename`, and `files`, plus the actual tarball. The
gate checks SHA-512 integrity and
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
inventory on both platforms. They are automated evidence requirements,
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
`version`, `ci_runs=ID`, and `acceptance_comment=ID`. Verification does not tag
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
can use an existing tag only when it resolves to the exact tested SHA and the
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

## After a bad publish

If a published version is broken, recover with a new version. A published npm
version and its `v<version>` tag are permanent records.

1. A package owner on npm restores the dist-tag to the last good version. The
   publish workflow cannot do this. Its trusted publishing only publishes.
   - For an RC: `npm dist-tag add react-native-swipeable-actions@<good> next`
   - For a stable release: `npm dist-tag add react-native-swipeable-actions@<good> latest`
   - If `next` has no earlier good version, remove it:
     `npm dist-tag rm react-native-swipeable-actions next`.
2. The owner deprecates the bad version, so that npm warns at install:
   `npm deprecate react-native-swipeable-actions@<bad> "<problem>. Use <good>."`
3. Never run `npm unpublish`. It breaks lockfiles that already resolve the version,
   and npm never allows that version number again.
4. Keep the `v<bad>` tag. Do not move or delete it. Add a note to its GitHub
   Release that names the problem and the replacement.
5. Fix the problem on `main` through the normal review. Then prepare the next exact
   version, for example `1.0.0-rc.<N+1>` after a bad RC. Run the complete procedure
   on that source: fresh full CI, physical acceptance, verify, then publish. No
   evidence of the bad version carries over. The publish of the corrective version
   moves its dist-tag to it.
6. The readiness gate and the publish workflow accept only `1.0.0-rc.N` and
   `1.0.0`. A patch release such as `1.0.1` needs a reviewed change first: extend
   the version pattern in `validateSource` in `scripts/release-readiness.mjs`, add
   its tests, and update the `version` input text in `publish.yml`. Then the patch
   goes through this same gate.
