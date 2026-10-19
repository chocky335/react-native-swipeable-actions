# Preparing and publishing v1

The prepared `main` revision is the release candidate. `CHANGELOG.md` is the
release-note source of truth. This procedure does not authorize a version change,
tag, dispatch, or publication by itself. Historical runs and local or offline
checks cannot replace a successful run of the prepared source.

## Prepare an unpublished exact version

1. Finish the implementation and its independent review. The full CI run must use
   the exact prepared source and version. Release candidates use an explicit
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
   A failed-jobs rerun is not release evidence. Do not change assertions, Mocha
   retries, the 120-second case deadlines, or the mobile job deadlines (45 minutes,
   and 70 minutes for an iOS shard, which can run two attempts).
   The only retry is the one [shard retry after host trouble](#inconclusive-host-runs)
   inside an iOS shard job.
   If the [physical iPhone check](#physical-iphone-check) applies, do it on the
   same SHA.

RC and stable preparation each change source identity. Evidence for an RC does
not authorize publishing a subsequently bumped stable package. Repeat the full
CI run on the stable source. If `main` moves before publication, prepare and
test the intended current revision again; never rewrite evidence to match it.

## Dependency advisories

The published package has no runtime dependencies. Advisories in the root lockfile come
from development tools and from the peer tree (React Native, Expo). Consumer apps install
their own peer versions. Advisories in `e2e/package-lock.json` reach only the E2E hosts.

Audit both lockfiles in the version change of Prepare step 2, before the Prepare step 4
CI run. A lockfile change after that CI run voids it.

1. Check the current override first. `e2e/package.json` forces `shell-quote`, because
   `@appium/support` pins it exactly. Remove the override, run
   `npm install --package-lock-only` in `e2e/`, and run the audit. If the audit shows
   a critical `shell-quote` advisory, restore both files with
   `git checkout -- e2e/package.json e2e/package-lock.json`.
2. Run `npm audit --package-lock-only` in the repository root and in `e2e/`.
3. For each critical advisory with a fix in the same major, run
   `npm update <package> --package-lock-only`.
4. If the audit still shows the old version, use one of these:
   - For a direct dependency, change its version in `package.json`.
   - For a transitive copy, add an `overrides` entry in that folder's `package.json`.
     Use a caret range in the same major, for example `"shell-quote": "^1.12.0"`.

   Then run `npm install --package-lock-only` in that folder.
5. Read the lockfile diff. Then run the audit again.
6. Open an issue that names the advisory and the blocking tool in these cases:
   - The fix needs a new major version.
   - An override makes the Prepare step 4 CI run fail. Remove that override in a new
     preparation change.

   Link the issue from the `## <version>` entry in `CHANGELOG.md`. Do not run
   `npm audit fix --force`.

The Prepare step 4 CI run is the only check that the tools still work with an override.

## Inconclusive host runs

Each iOS shard job runs its spec in an attempt directory: `attempt-1/`, and
`attempt-2/` after a retry. Each attempt has its own receipt, NDJSON results in
`ios-results/`, Appium log, simulator log, host load and `ios-evidence/host-health.json`.
The host load has a `top` sample every 5 seconds for the whole attempt.

`host-health.json` compares the simulator log and the host load with the NDJSON
results. Each failure has a window: a failed test from its start to its result, a
failed hook, or a failed warm-up. A test without a result fails, and its window ends
at the next record. A gesture counts in the window that contains its start. A load
sample counts in the window that contains its time. The `e2e-ios` job summary shows
the gate checks and one host class for each attempt. The gate checks column uses the
same checks as the gate for that attempt: the step outcomes, the warm-up and the full
case inventory. It lists each condition that fails.

- `host trouble`: the gate rejects the attempt only for failed cases and touch
  readiness timeouts, and host trouble explains each of them.
  - A failed case needs at least one gesture in its window that went to latent
    system gesture destinations of the app scene. The simulator sent these
    gestures to SpringBoard first, and the app did not get them.
  - A touch readiness timeout is a hook that fails with `Touch readiness gate
    failed`, for example the relaunch in `afterEach`. Its window needs at least one
    load sample, and each sample in it needs a 1-minute load average of 100 or more.
    The runner has 3 vCPUs. At load 100, a relaunch that needs 1 CPU second on an
    idle host needs about 33 seconds. That is more than the 30-second phase of the
    readiness gate. A host that keeps up has a load near 3. In the stored shard
    evidence of three runs, the overload never fell below load 136.

  These effects of the failures are part of them:
  - A Maestro step that a failed WDIO step skipped.
  - A worker result of one Mocha failure for each failure.
  - A larger worker result, when the worker ends directly after the last failure
    and its worker-end record shows a quarantine that started in that failure.
  - The cases that never started, when a touch readiness timeout ends the worker.
    Mocha starts no later case of the suite after a failed hook.

  A failed Maestro step or warm-up, a skipped, pending or unfinished case, another
  failed hook, a failed worker or any other missing case is a real failure. Then
  the attempt is never `host trouble`.
- `host mixed`: host trouble explains some failure windows and not others, or the
  gate also rejects the attempt for another reason. The other failures and
  rejections are real failures.
- `host healthy`: host trouble explains no failure window, or the attempt has no
  failure. A latent-routed gesture during a passed warm-up or test does not count.
- `host unknown`: the attempt has no usable simulator log, or it has latent-routed
  gestures and no test results.

The summary shows the latent-routed gestures in failure windows and in total.
Host trouble never makes a case pass. It only permits one retry of a shard:

1. If attempt 1 fails, the `Run E2E tests` step classifies it. The step retries the
   shard once, in the same job, only when all of these are true:
   - The WDIO run of attempt 1 failed, and Maestro did not run.
   - The classifier finds `host trouble` in the raw evidence of attempt 1.
   - The `host-health.json` of attempt 1 says `host trouble`.
2. Before attempt 2, the step boots the simulator again. Attempt 2 starts a new
   Appium server, WebDriverAgent session and app.
3. Attempt 2 must pass every case of the shard, with no Mocha retry. Maestro runs
   once, after the WDIO run that passed. A Maestro failure never gets a retry.
4. The receipt of attempt 2 records `attempt: 2` and its `retryReason`: the host
   class of attempt 1. The shard artifact keeps both attempts.
5. A shard never gets a second retry. If attempt 2 fails, the shard fails.

The iOS shard job deadline is 70 minutes, so that two attempts fit. A job that
reaches its deadline fails.

1. If the last attempt of each failed shard shows `host trouble`, the run is
   "inconclusive (host)". It is not release evidence. One failure that host trouble
   does not explain makes the run a real failure.
2. Never rerun failed jobs, and never retry individual tests. The shard retry above
   is the only retry.
3. Dispatch a fresh full run only after an inconclusive (host) run.
4. Release evidence is a fully green full run. A shard that passes in its retry is
   green.

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
`ios-shard-<sha>-<run>-1-<shard>` artifacts. Each shard artifact has `attempt-1/`,
and `attempt-2/` after a retry. The gate rediscovers the maintained
inventory from the prepared checkout, compares source hashes and case identities,
then validates raw NDJSON, worker completion, receipts, zero Mocha retries and
skips, all 62 cases and Maestro. A shard passes with one green attempt, or with a
green attempt 2 after a [retry](#inconclusive-host-runs). For a retry, the gate
classifies attempt 1 again from its raw NDJSON, host load and simulator log. Both
that verdict and the stored `host-health.json` must say `host trouble`, and the
receipt of attempt 2 must give the same retry reason. A third attempt, a retry
after an attempt 1 that host trouble does not explain, and an incomplete or retried
attempt 2 fail closed. The report lists each retried shard and its reason in
`iosRetries`. Records of every attempt must belong to the run's time interval.
Android uses the actual `e2e-android` job log: five completed spec workers, the
complete WDIO summary and every passing case title (including duplicate counts) are required.
A success badge, hand-entered count or summary without case output cannot pass.
Missing/expired artifacts or logs and changed reporter formats fail closed.
Recycling, detach and RTL remain mandatory in this same-source 62-case E2E
inventory on both platforms. They are automated evidence requirements.

## Physical iPhone check

Simulators cannot show haptics. Run this check on a physical iPhone with the
prepared SHA in these cases. The publish workflow does not check it.

- No earlier check SHA is recorded.
- Since the last check SHA, one of these changed: `ios/` code, TypeScript code for
  haptics, appearance or Reduce Motion, or the React Native or Expo version in
  `example/package.json`.

Steps:


1. Build the example app in Release configuration on the iPhone.
2. Inspect the default row and action appearance.
3. Swipe both edges and tap the revealed actions.
4. Feel Auto feedback. Cross the threshold several times in one gesture, and make
   sure the feedback does not repeat.
5. Feel feedback with haptics on. Make sure nothing plays with haptics off.
6. Make sure programmatic changes, cancellation and auto-close play no feedback.
7. Change Reduce Motion while the app runs. Check its live effect on motion, and
   make sure Auto feedback does not change.

If a check fails, fix it and prepare the release again. If all checks pass, write
the tested SHA, the device and the iOS version in a comment on the preparation PR.
The next check compares against that SHA.

## Verify, then publish

Configure the GitHub `npm-release` environment with a main-only deployment rule,
and npm trusted publishing for this workflow. A required reviewer is optional. It
adds an approval step before each run. Retain
the reviewed `main` workflow as the authority. Dispatch **Publish to npm** from
the prepared `main` revision with `operation=verify`, full `source_sha`, exact
`version`, and `ci_runs=ID`. Verification does not tag
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
   on that source: fresh full CI, the physical iPhone check if it applies, verify,
   then publish. No
   evidence of the bad version carries over. The publish of the corrective version
   moves its dist-tag to it.
6. The readiness gate and the publish workflow accept only `1.0.0-rc.N` and
   `1.0.0`. A patch release such as `1.0.1` needs a reviewed change first: extend
   the version pattern in `validateSource` in `scripts/release-readiness.mjs`, add
   its tests, and update the `version` input text in `publish.yml`. Then the patch
   goes through this same gate.
