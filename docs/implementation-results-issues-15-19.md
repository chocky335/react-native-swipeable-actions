# Implementation results: issues 15 and 19

## Current validation status (2026-09-09)

**Latest-main integration has passed local unit/native checks; fresh CI and
integrated-device acceptance are still pending.**

## Latest-main integration

The PR incorporates `main` at `ded435dc8f87cf300f2d632646e23d368592758e` with a
normal merge, retaining upstream release metadata and fixes rather than replacing
conflicting files wholesale. The new side-aware API retains main's existing
ref/static/raw cancellation methods and public test mock behavior.

- JavaScript: **62/62**, all six maintained suites. The local invocation used
  `--roots src` because the isolated baseline checkout under ignored `e2e/logs/`
  otherwise appeared as a second project to Jest. No maintained tests were omitted.
- Swift: **76/76**, including new integration and cached-close ordering tests.
  These package tests do not compile or exercise the UIKit view/module.
- Android native: **115/115 Debug and 115/115 Release**, retaining all prior tests
  and adding cancellation, stale-command, touch suppression, and width checks.
- TypeScript, legacy/two-sided compatibility fixtures, and formatting of the
  changed TypeScript files passed. These results total **368/368 unit/native test
  executions**, not full E2E acceptance or a code-coverage claim.
- Upstream iOS child mounting, transform cleanup, width resynchronization,
  recycled-row closing, interrupted-work handling, and gesture priority are
  integrated with two-sided restoration and binding guards. Parent review caught
  and corrected an unbound-close/remount ordering issue before commit.
- Upstream example Reanimated pin, updated Appium/XCUITest dependency versions,
  and prebuilt WebDriverAgent CI support are retained.
- The pre-integration branch's [CI run 34277897167](https://github.com/chocky335/react-native-swipeable-actions/actions/runs/34277897167)
  passed lint but failed installing example dependencies before unit/native or
  E2E execution. Its broad Reanimated range selected 4.6.0, incompatible with
  React Native 0.81.5. Main's existing `~4.3.0` pin addresses that resolution
  failure; no force-install or peer-dependency bypass was added.

Fresh CI must run on the merge commit with both E2E platforms enabled. The
parallel same-Xiaomi comparison remains pinned to the passing baseline
`60078b953a629f998fb4a3615d7015ca6c4e171e` and pre-integration `7197fb0`; its
results must not be represented as validation of the newly integrated native code.

## Pre-integration validation (commit `7197fb0`)

The following results describe the pre-integration branch, not the newly merged code.
The final maintained suites passed **403/403 test executions, with zero failures
and zero skipped tests**. This is a test pass rate, not a claim of 100% branch
coverage. Historical failed attempts and focused diagnostic runs are not included
in these final totals.

| Suite | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| JavaScript / React, six Jest suites | 57 | 0 | 0 |
| Swift native tests | 66 | 0 | 0 |
| Android native, Debug | 95 | 0 | 0 |
| Android native, Release | 95 | 0 | 0 |
| iOS simulator E2E | 45 | 0 | 0 |
| Android emulator E2E | 45 | 0 | 0 |
| **Total** | **403** | **0** | **0** |

Both final E2E runs were unfiltered: 25 legacy tests, 19 two-sided tests, and the
benchmark test. They used the current test harness and freshly built Release apps.

## Latest physical Xiaomi run: 44/45, one failure

- Xiaomi `M2101K9AG`, serial `1f087aee`, Android 13/API 33, `arm64-v8a`.
- **44 passed, one failed, zero skipped, zero unexecuted, zero hook failures.**
  Performance passed 1/1, legacy passed 24/25, and two-sided passed 19/19,
  including all four recycling cases. WDIO exited 1 after 19m34s.
- Legacy Test 5 failed because `reply-preview` remained undisplayed for its
  unchanged 10-second wait after the first reply swipe opened the keyboard.
  Sender and final auto-close assertions were not reached. The screenshot shows
  the keyboard covering the bottom of the chat; the exact layout cause is still
  under investigation. Test 6 passed with the same swipe coordinates while the
  keyboard was already open.
- Evidence: `/private/tmp/swipeable-100-xiaomi-acceptance/wdio-console.log` and
  `/private/tmp/swipeable-100-xiaomi-acceptance/android-60611-1788898205202-should-auto-close-and-show-correct-reply-preview-on-swipe.png`
  with its matching `.xml` hierarchy.
- The installed Release APK SHA-256 matched the binary recorded below. No
  library, demo, or test assertions were changed for this run; all 45 tests ran
  unfiltered with their original deadlines and without retries.
- Background safety monitoring recorded 1,799 clear probes with zero errors or
  stops. All owned test processes and monitors ended. The Pixel, Lanka, device
  notification settings, and other applications were left untouched.

The focused original Tests 5 and 6 subsequently **both passed unchanged** in 42
seconds, starting with the keyboard closed. This was diagnostic only: 43 other
tests were outside its authorized selection, so it does not replace full
acceptance. No source edits, rebuild, retries, or relaxed assertions were used.

In both passing cases the chat root ended at physical y=1569, exactly where the
IME began; reply-preview bounds were `[0,1260][1080,1409]` and input bounds were
`[22,1433][859,1547]`, above the keyboard. In the earlier full-run failure the
chat root instead ended at y=2270 while the keyboard covered the composer.
The omitted accessibility nodes do not prove whether the composer remained
mounted below the IME. No JS exception or Android crash was recorded in the
focused run. The intermittent layout failure's cause remains unconfirmed; no
speculative demo or native fix was applied.

Diagnostic evidence is in
`e2e/logs/xiaomi-keyboard-diagnostic-2/wdio-console.log`, `test-5.json`, and
`test-6.json`. An earlier diagnostic attempt executed no tests because host
temporary-file writes failed with ENOSPC. Existing evidence was preserved and
the successful diagnostic used the workspace's external volume instead; Android
device storage was not the failing target.

Full Xiaomi acceptance therefore remains **44/45**. The 403/403 native/unit and
simulator/emulator total above is separate from this failed physical run and is
not an overall 100% claim.

## Physical Pixel follow-up: acceptance remains incomplete

The simulator/emulator/native totals above do not include these incomplete or
failed physical-device attempts. They are not an overall 100% acceptance claim.

- Latest physical run: **31 test bodies passed, zero test bodies failed, zero
  skipped, and 14 unexecuted**, with **one failing beforeEach setup hook**.
  Performance passed 1/1, legacy passed 25/25, and two-sided passed five tests
  before setup failed. WDIO exited 1 after 15m10s.
- The pre-cleanup screenshot and hierarchy show Android's **Open with Lanka Dev**
  chooser covering the demo. The setup could not click `config-header`.
  The chooser's launch source is not established; it was not dismissed and no
  default-app or notification settings were changed.
- Evidence: `/private/tmp/swipeable-100-pixel-acceptance-async-guard/wdio-console.log`
  and `/private/tmp/swipeable-100-pixel-acceptance-async-guard/hook-failure-98201-1.png`
  with matching `.xml` and `.json` files.
- The preceding complete physical attempt ran all 45 tests: **41 passed and four
  failed** in 36m10s. All four recycling cases exceeded the unchanged 120-second
  whole-test limit, without recorded assertion mismatches. Its temporary alert
  guard performed blocking window probes before interactions. That runner
  overhead was removed before the latest attempt; tests and library code were
  not changed. Evidence: `/private/tmp/swipeable-100-pixel-acceptance/wdio-console.log`.
- The revised temporary guard performed 1,196 sequential background probes with
  zero errors or alert stops. Its 2,406 in-memory interaction checks took 0.775ms
  in total. Monitoring was stopped and all owned test processes were cleaned up.
- The device was Pixel 8 Pro `3C091FDJG001PW`, Android 17/API 37, `arm64-v8a`.
  Enforced installation used the Release APK identified below; the installed
  SHA-256 matched. No test filters, retries, skips, relaxed assertions, or longer
  test deadlines were introduced.

A new complete physical-device run is still required in an uninterrupted device
session. The successful simulator and emulator results remain separate evidence.

## Acceptance environments and evidence

- iOS: iPhone 17 Pro simulator, iOS 26.5, UDID
  `D977AAC0-23E6-4CF4-ADBD-8C7F1FAE4EB3`. Final full run: 17m17s, exit 0.
  [iOS results](/private/tmp/swipeable-100-ios-acceptance/e2e.log).
- Android: disposable `lanka_ki167_disposable` emulator, Android 15 / API 35,
  `arm64-v8a`, 1008x2244 at density 360. Final full run: 10m28s, exit 0.
  [Android results](/private/tmp/swipeable-100-android-emulator/wdio-console.log).
- The Android build and installed APK were checked against SHA-256
  `576e661466f8f3f0095fe8c6ca7e6cd2aaad7b09465266574882b5089f97168f`.
  The emulator ran read-only and exited without saving snapshot or userdata changes.
- The physical Pixel's complete acceptance run was obstructed by a system
  emergency-alert banner covering the app controls. No physical-device 45/45
  claim is made. The alert was not dismissed or disabled; validation moved to
  the disposable emulator. Physical-device focused checks had already passed
  the benchmark and all four previously timing-out recycling cases.
- Native Android tests passed in both variants with 32 physics tests, 12
  side-selection tests, and 51 view tests each.
  [Native Android results](/private/tmp/swipeable-android-pointer-gate-tests.log).

## Fixes reviewed and exercised

- iOS restores native-owned visibility, interaction, accessibility, and transform
  state before a child returns to Fabric's reuse pool. Original visibility flags
  are retained through weak ownership rather than forcibly unhiding caller views.
  Six regression tests were added. The unchanged legacy pixel-comparison test
  and all two-sided recycling/reorder/reattach tests pass.
- Android prevents invisible action slots from intercepting React Native touches
  using native `pointerEvents` gating, with restoration on removal or mode changes.
  Six regression tests were added, including a real delivered-click assertion.
- Static and raw-view command binding guards remain intact. Commands for one
  current binding retain FIFO behavior; rebind/detach invalidates stale commands.
- Android threshold tests now express drags in React Native layout units, scaled
  to physical pixels. Library physics and thresholds were not changed to satisfy
  those tests, and the existing pixel/fraction gesture helper contract remains.
- Android testID lookups use direct resource IDs with prefix autocompletion
  disabled. Driver idle/selector waits are bounded; explicit assertions retain
  their original deadlines. Cold-relaunch setup includes a one-second Android
  settling interval, with system animations left enabled.
- The two-sided demo disables FlashList scroll anchoring so reordered first rows
  remain available to the existing geometry assertions. Tests explicitly wait
  for both frames. Reorder, rebind, detach, action, callback, and offset assertions
  remain in place. The screenshot tolerance remains `0.005`.
- E2E scripts include all three specs and clear stale test-selection filters.
  Android installation is enforced, and independent Appium ports support both
  platform runs without testing an older APK.

## Compatibility and remaining scope

The existing API, legacy callback behavior, bridge command arity, and default
appearance were preserved. Two-sided actions and the iOS appearance option remain
additive. Library build, library/example/E2E type checks, and formatting checks
passed. Lint exited successfully with existing warnings and custom-rule diagnostics.
Jest used `--watchman=false` to avoid the desktop sandbox's Watchman permission issue.

The original user-owned example/event-log changes were preserved. No commit,
release, dependency-version bump, or notification-setting change was made.
Physical iPhone haptic feel and manual Reduce Motion visual QA are not claimed
by these automated simulator results.

---

## Historical runs: superseded, not current results

<details>
<summary>Earlier failed runs, retained for traceability</summary>

### Earlier implementation snapshot

Implementation has been applied in the current workspace. This execution record
supplements the original implementation plan. No commit, release, or publication
was performed.

**Historical status, superseded:** this early run exposed failures before the
subsequent fixes and successful simulator/emulator acceptance runs above.

## Delivered

- Independent left and right action rails, widths, lazy mounting, and side-specific
  end callbacks on iOS and Android.
- Optional side arguments on the high-level ref and static open methods, with
  additive native commands rather than changed legacy bridge signatures.
- Physical left/right edge semantics, a side latched for each gesture, and guarded
  animation, recycling, and queued-command lifecycle handling.
- An opt-in `appearance="ios26"` iOS-inspired action-rail effect and configurable
  haptic feedback, including Reduce Motion handling. This is not a native Mail or
  Liquid Glass implementation. Android appearance is unchanged.
- A two-sided example screen, public documentation, compatibility fixtures, unit
  coverage, and a new device E2E specification.

## Compatibility constraints retained

- Legacy `SwipeableProps` remains an extendable interface with required `actions`
  and `actionsWidth`. New two-sided configurations have additive exported types.
- Existing one-sided JSX, ref methods, static methods, raw native commands, and
  default appearance remain supported.
- Aggregate callback argument counts and legacy auto-close end-state behavior
  remain unchanged. Side metadata is handled internally or through new callbacks.
- Legacy native child ordering is retained; only two-sided configurations use
  separate left and right slot shells.
- No minimum-platform, SDK, or dependency version increase was introduced.
- Existing user-owned example event-log and configuration work was preserved.

## Review corrections

- Corrected queued-command invalidation: animation generation must not invalidate
  another legitimate command queued for the same row binding. Binding identity
  guards stale commands separately on both platforms.
- Corrected example and documentation rails to use explicit configured widths
  inside the full-bounds native slot shells.
- Added compatibility coverage for inferred legacy component props and refs,
  additive side configuration, callback arity, and recycled-row event handling.

## Checks completed during implementation

- Library build and compatibility TypeScript compilation passed.
- Jest: 57 tests passed across six suites.
- Swift: 60 tests passed after the command-binding correction.
- iOS native library compiled successfully for simulator architectures.
- Android: the full native suite passed with 81 tests in each Debug and Release
  configuration before the final queue correction. After that correction, the
  expanded lifecycle suite passed with 45 tests in each configuration, including
  eight new queued-command regressions; native compilation also passed.
- Example and E2E TypeScript compilation passed.
- Source lint completed without errors, with existing tooling warnings/info.

## Follow-up: raw command guard and device validation

Raw iOS native-view `open` and `close` now use a weak binding target. Rebinding or
detaching invalidates queued work, including unkeyed refs. Same-binding commands
remain ordered independently of animation cancellation. Existing method names,
arguments, and defaults are unchanged.

Fresh iOS and Android Release example builds passed. All 60 Swift tests passed
again. Both full E2E specifications were run against the fresh builds:

| Historical device | Historical suite | Passed then | Failed then |
| --- | --- | --- | --- |
| iPhone 17 Pro simulator, iOS 26.5 | Two-sided | 15 | 4 |
| iPhone 17 Pro simulator, iOS 26.5 | Legacy | 24 | 1 |
| Pixel 8 Pro | Two-sided | 14 | 5 |
| Pixel 8 Pro | Legacy | 21 | 4 |

### Findings from the superseded run

- iOS two-sided: all four recycling cases fail. The screenshot confirms that row
  content disappears while its action rail remains visible after reorder or
  reattachment. This is not merely an inaccessible geometry marker.
- Android two-sided: a left-action tap does not update its counter after explicit
  disabling of the legacy right fallback. Both FlashList recycling cases cannot
  find row 1 after reorder; both FlatList recycling cases exceed 120 seconds.
  The missing-row and timeout failures still need separation from harness issues.
- iOS legacy: the list-type round-trip screenshot comparison differs by about
  0.5801%, above its 0.5% limit. A focused rerun also failed. The cause has not
  been isolated; this alone does not establish a regression introduced here.
- Android legacy: keyboard persistence exceeds 120 seconds. Three threshold and
  drag-offset tests also fail; their fixed swipe distances are physical pixels,
  whereas the configured native thresholds use dp. The harness needs density-aware
  distances, not altered library gesture thresholds. Keyboard behavior remains
  unverified by the timed-out case.

At this point, additional fixes were awaiting approval. They were subsequently
authorized, implemented, and tested as described in the current acceptance record
above. No assertions were weakened.

### Run integrity and evidence

The initial Android run used an older installed demo because Appium reused a
matching version. Its results are discarded. This historical full run used an
explicitly replaced APK whose installed and local SHA-256 hashes matched:
`b7709275bfe7abbb80e9e03b53dc3214736f58e2f4580fabea8c1a6278feacb7`.

- [iOS full run](/private/tmp/swipeable-ios-e2e.log)
- [iOS visual rerun](/private/tmp/swipeable-ios-visual-recheck.log)
- [iOS missing-content screenshot](/private/tmp/swipeable-ios-recycling-failure.png)
- [iOS accessibility hierarchy](/private/tmp/swipeable-ios-failure-source.json)
- [Historical Android full run](/private/tmp/swipeable-android-device-20260908/final-wdio-console.log)
- Android failure screenshots and XML are in
  `/private/tmp/swipeable-android-device-20260908/final-e2e/`.

### Validation limits recorded at that time

- Swift command-order tests exercise the binding helper, not a dedicated UIKit
  scheduling-race test of the raw native bridge.
- Functional appearance, reveal-width, and action-target checks passed in both
  device suites. Physical iPhone haptic feel, Reduce Motion presentation, and a
  full visual/accessibility review remain unverified.

## Delegation

Spark subagents began implementation. Spark reached its usage limit, so inherited
current-model workers completed the platform and example work. The parent handled
the React/TypeScript integration and reviewed the delegated changes.

</details>
