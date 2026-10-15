# Issue 15: independent left and right swipe actions

## Delivery scope

This is the first delivery for
[issue 15](https://github.com/chocky335/react-native-swipeable-actions/issues/15).
It adds independent physical-edge action content and widths, side completion callbacks,
side-aware ref/static opens, lazy mounting, and keyed restoration for two-sided rows.
This is PR21; the reviewed issue-15 revision is `a92045c`. PR22 stacks the optional
issue-19 appearance work on top of it.

The existing legacy props, callback arity, ref/static/raw commands (including cancel),
defaults, and native bridge entry points remain supported. The change incorporates
main's recycling, command ordering, width synchronization, and gesture priority fixes.

Optional iOS appearance, threshold haptics, scale/pop effects, and their tests belong
to the separate stacked delivery for issue 19. They are not prerequisites for issue 15.
Caller-owned rounded buttons, inset layouts, and multiple actions remain supported.

## RTL and translated content

- Left/right are physical, not logical start/end, in both layout directions.
- Global RTL action alignment uses React Native's I18nManager state.
- Legacy action containers also compensate for RTL flex alignment, fixing actions
  appearing on the wrong physical edge without changing LTR alignment or public props.
- Translation-only updates can replace labels and explicit widths on the existing row.
- Global LTR/RTL setting changes require a full app restart, not just a rerender.
- Logical start/end mapping is caller-owned; close rows before exchanging their actions.
- Per-row direction overrides are outside this delivery's contract.

## Acceptance requirements

Run the maintained JavaScript, Swift, and Android native tests plus API compatibility
type fixtures. Swift package tests exclude the UIKit view/module, so they do not replace
a Release app build and simulator tests.

Run the full Android and iOS E2E suites, including legacy behavior, two-sided actions,
RTL/language changes, benchmark, and the iOS Maestro seekbar regression. Tests must
retain their assertions and deadlines. Focused diagnostics do not substitute for a
complete run. Report setup failures, unexecuted cases, and skips separately from passes.

The iOS CI runner now uses the prebuilt WDA test products through Xcode's
test-without-building path. Its earlier direct-launch path never established a session
and exhausted the job deadline. A successful fresh run is required before calling the
runner fix or this delivery accepted; the 45-minute timeout is unchanged.

## Reported acceptance snapshot for PR21

- CI run `38623464130` completed with overall status cancelled. Lint, test, and
  Android jobs succeeded. WDA started successfully, but iOS exceeded the 45-minute
  job limit after three test timeouts in the RTL suite's translated-width/rebind/detach
  cases: LTR FlatList left, LTR FlatList right, and RTL FlatList left.
- Only the benchmark spec completed before the interrupted RTL spec; legacy and
  two-sided specs did not start. Cancellation prevented an aggregate test report,
  so exact iOS pass/skip totals are unknown. Maestro was skipped. This is not a
  zero-failure result and must not be attributed to the earlier WDA startup failure.
- Android CI is verified at 59/59 passed, including 14 RTL cases, with zero skips.
- The Xiaomi `M2101K9AG` was identified through the authorized helper. The new
  `a92045c` build and harness with the correct CI dependencies are prepared, but
  physical-device acceptance is 0 started, 0 passed, 0 failed, and 59 not run.
  The helper provides ADB/video forwarding, not the required UiAutomator2 HTTP route.
  No new tunnel was created and no Pixel interaction occurred.
- Full iOS acceptance and the Xiaomi run remain incomplete. Android CI success does
  not establish either gate, and historical results below do not replace them.

## Historical evidence, not acceptance of the split

- Combined commit 24eeace passed 368 local unit/native test executions and 45 Android
  CI E2E tests. Its iOS CI was cancelled after WDA session startup failures.
- On the same Xiaomi, baseline 60078b9 passed 17 shared tests and pre-integration
  7197fb0 passed all 45 expanded tests. This did not validate 24eeace or this split.
- The earlier intermittent keyboard failure did not reproduce in that comparison;
  no speculative keyboard fix or claim that its cause is resolved is included.

Fresh commit-specific CI/device results are tracked in the delivery PR. Keep it draft
until its acceptance gates pass. The old combined implementation notes remain available
in commit 24eeace rather than being presented as current results for either split PR.
