# Issue 15: independent left and right swipe actions

## Upcoming 1.0.0 scope

The approved major-release direction supersedes the additive compatibility contract of the
earlier [issue 15](https://github.com/chocky335/react-native-swipeable-actions/issues/15)
delivery. The component accepts explicit left/right content and width pairs only.
`SwipeableProps`, `TwoSidedSwipeableProps`, and `SwipeableComponentProps` describe the same
canonical shape. There is no `actions`/`actionsWidth`/`actionsPosition` fallback.

All rows use the stable three-slot engine, including migrated single-side list, seekbar,
and chat rows. Ref/static methods and callback argument lists remain unchanged. Default
open selects enabled right, otherwise enabled left. The user explicitly approved the
new engine's disabled-edge, state-callback, and instant-close/cache-restoration behavior
instead of retaining legacy quirks. This document does not claim release or acceptance.

The stable native child layout and internal side/key event metadata are implementation
details, distinct from those user-visible behavior changes. Consumers do not supply a
child-slot count or receive extra arguments in the component's public callbacks.

Optional iOS appearance, threshold haptics, scale/pop effects, and their tests belong
to the separate stacked delivery for issue 19. They are not prerequisites for issue 15.
Caller-owned rounded buttons, inset layouts, and multiple actions remain supported.

The appearance PR has not been merged into this delivery. Its separate implementation
and acceptance must not be attributed to this API migration.

## RTL and translated content

- Left/right are physical, not logical start/end, in both layout directions.
- Global RTL action alignment uses React Native's I18nManager state.
- Every action slot compensates for RTL flex alignment while preserving physical edges.
- Translation-only updates can replace labels and explicit widths on the existing row.
- Global LTR/RTL setting changes require a full app restart, not just a rerender.
- Logical start/end mapping is caller-owned; close rows before exchanging their actions.
- Per-row direction overrides are outside this delivery's contract.

## Acceptance requirements

Run the maintained JavaScript, Swift, and Android native tests plus canonical API and
removed-prop rejection type fixtures. Swift package tests exclude the UIKit view/module, so they do not replace
a Release app build and simulator tests.

Run the full Android and iOS E2E suites, including all 25 original single-side scenarios, two-sided actions,
RTL/language changes, benchmark, and the iOS Maestro seekbar regression. Tests must
retain their deadlines, hooks, retries, and behavioral assertions except for the explicitly
approved migration changes below. Focused diagnostics do not substitute for a
complete run. Report setup failures, unexecuted cases, and skips separately from passes.

The iOS CI runner now uses the prebuilt WDA test products through Xcode's
test-without-building path. Its earlier direct-launch path never established a session
and exhausted the job deadline. A successful fresh run is required before calling the
runner fix or this delivery accepted; the 45-minute timeout is unchanged.

## Demo and assertion migration map

- List rows: select an explicit left/right pair at width 144. Seekbar: select its pair
  at width 80, preserving its child gesture and keyless use. Chat: select the physical
  reply edge and retain progress, haptic, auto-close and reply callback wiring.
- The 40-row two-sided fixture and all lifecycle controls remain. The former fallback
  control selects alternate explicit right content; it does not pass removed props.
  Existing technical IDs `mixed`, `legacy-only`, and the alternate action's `legacy`
  suffix remain for selector compatibility. User-facing labels are explicit-content
  and right-only labels, and the action counter is labelled `alternate`.
- `swipeable.spec.ts`: all 25 cases and all assertion bodies remain; only explanatory
  comments change. Existing tests observe supported row behavior, not the removed
  wrong-direction rubber-band or incidental callback sequences.
- `two-sided.spec.ts`: retain 19 cases. Replace fallback-precedence expectations
  with visible alternate explicit content and absent normal right content. Disabling
  that edge still must close it, suppress explicit opens and wrong-direction gestures,
  preserve counters, and leave the opposite edge usable. Press-count assertions retain
  their numeric expectations with the counter label changed to `alternate`.
- `rtl.spec.ts`: retain 14 cases. The former legacy-only cases now select explicit
  right-only content in both global directions. Gesture, command, live translated-width,
  content identity, callback counts and physical geometry expectations remain.
- The benchmark remains one case: total E2E inventory stays 59. Maestro's seekbar
  regression is unchanged. Full lifecycle cases retain both rows, rebind/reorder,
  detach/reattach, final closeAll and second reattach with closed-cache offsets.
- Approved behavior changes: disabled-edge drags do not start an opening lifecycle;
  state callbacks follow the latched enabled edge; instant close and restoration use
  the canonical engine's cache/callback semantics. No E2E callback count was loosened
  to accommodate these changes. Exact state/instant-close callback regressions belong
  to the runtime/native suites; the demo counters observe start/end, not state callbacks.

No validation of this migration is claimed here. Run typechecks and offline inventory/
regressions only after the runtime owner reports readiness; mobile acceptance requires
separate authorization. Preserve the 120-second cases and 45-minute CI job limits.

### Original 25-scenario ledger

Each numbered scenario remains in `swipeable.spec.ts` with its original assertions,
hooks and timing. These now exercise explicit-side rows on the canonical engine.

| Case | Retained scenario |
| --- | --- |
| 0 | Basic swipe open/close |
| 1 | Leading/left-edge swipe open/close |
| 2 | Revealed action tap and alert |
| 3 | Close All on open rows |
| 4 | Open-state persistence through recycling |
| 5 | Chat auto-close and correct reply preview |
| 6 | Keyboard persistence during auto-close |
| 7 | Close All after navigation away and back |
| 8 | Disabled gesture prevents opening |
| 9 | Re-enabled gesture opens again |
| 10 | Disabling gestures while open closes and resets the row |
| 11 | Disabled gesture with leading actions |
| 12 | Close All remains usable with gestures disabled |
| 13 | Close All after clipped detach/reattach |
| 14 | Seekbar child pan does not open the row |
| 15 | Reordering retains the open row |
| 16 | Visual integrity after the FlatList round trip |
| 17 | Below-threshold release closes |
| 18 | Above-threshold release opens |
| 19 | Changing threshold changes the snap decision |
| 20 | Edge drag offset blocks short drags |
| 21 | Ref close(false) resets every row in both directions |
| 22 | Sibling rows stay independently open |
| 23 | Close All before any swipe remains harmless |
| 24 | Leading action tap triggers the correct alert |

The gate remains 25 single-side + 19 two-sided + 14 RTL + 1 benchmark = 59 cases,
with Maestro required separately. No old scenario is replaced by a skip or removed
because its demo previously used the old API. Root unit/type results and offline
inventory checks do not establish that these mobile scenarios have passed.

## Historical acceptance snapshot for PR21 (pre-1.0.0 migration)

The earlier additive revision was `a92045c`; PR22 stacked optional issue-19 appearance
work on it. The following records describe that earlier implementation, not the new API.


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
