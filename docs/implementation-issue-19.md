# Issue 19: optional iOS-inspired appearance and haptics

## Stacked delivery

This follow-up to issue 15 addresses
[issue 19](https://github.com/chocky335/react-native-swipeable-actions/issues/19).
Its PR is based on the issue-15 branch until that delivery merges, then can be
retargeted to main. Review this PR against its selected base to see only the
appearance changes, not the independent two-sided implementation.
PR22 now integrates appearance on the breaking, explicit-only upcoming 1.0.0 base.
The appearance layer is additive to that new base; it does not preserve or restore
the removed `actions`, `actionsWidth`, or `actionsPosition` API. Single-side rows
use one explicit side pair on the same engine as rows with both sides enabled.
The physical-edge API, RTL alignment, and their common documentation belong to PR21;
the optional appearance/feedback props and their acceptance checks belong to PR22.

`appearance="ios26"` opts into native iOS rail entry/pop motion. The default keeps
the previous presentation. `hapticFeedback` explicitly enables/disables one native
light impact at the first opening-threshold crossing in a gesture; when omitted,
the effective value is `hapticFeedback ?? (appearance === 'ios26')`: enabled for
`ios26`, disabled for `default`. The example's Auto control omits the boolean prop;
`'auto'` is not an API value. Both props support migrated explicit single-side rows
and rows with both sides enabled.
Programmatic opens, remounts,
recycling, and auto-close do not synthesize a new threshold impact.

This is iOS-inspired motion, not Apple's native Mail/Notes control, Liquid Glass,
or a claim of exact system-control parity. Rounded/inset/multiple buttons remain
caller-owned React content. No new blur dependency, SDK minimum, or Android motion
change or Android haptic feedback is introduced by the appearance layer. The physical-side
and RTL contracts of the new 1.0.0 base remain intact; its approved behavioral changes
still apply to migrated single-side rows. Global RTL changes require an app restart; translation-only
label/width updates can happen live without changing the item's recycling key.

iOS Reduce Motion suppresses the preset's entry/pop scaling, including when toggled
while mounted. It retains normal row translation and open/close animations, and does
not override the haptic preference. This behavior still requires human acceptance.

## Automated checks

Retain the appearance/feedback native and React regressions alongside the canonical
API migration tests. The earlier split restored seven Swift appearance/feedback tests
and two React prop/default/platform tests; those historical counts are not evidence
that the current integration passes. The two-sided E2E styling case additionally
exercises the preset and explicit haptic options while retaining reveal-width and
tappability assertions. All 25 original single-side scenarios remain, with 19 two-sided,
14 RTL and one benchmark case: the gate remains 59 cases plus required Maestro.
Do not change assertions, hooks, retries, or deadlines to obtain a passing merge.

Swift package tests exclude UIKit; a successful native app build and full iOS E2E
run are required. Simulator tests cannot establish physical haptic feel. Fresh,
commit-specific results belong in the PR, not in claims derived from the older
combined branch.

## Historical acceptance snapshot for PR22 (before the 1.0.0 migration)

The following evidence was recorded for the earlier appearance delivery `411719a`,
stacked on PR21 `a92045c`, or for the older owner-tested app described below. It is
preserved as history, not acceptance of the current explicit-only API integration.
In particular, prior owner feedback on that old build cannot establish new-migration
acceptance, even when the intended appearance/haptic behavior is unchanged.

- CI run `38624200228` completed with overall status cancelled. Lint, test, and
  Android jobs succeeded. This PR's Android run is independently verified at 59/59,
  with zero failures or skips across all four spec files.
- WDA started successfully. iOS completed the benchmark, RTL and legacy specs,
  then exceeded the 45-minute job limit during the two-sided spec. That spec had
  already reported one timeout in its FlatList left restore/resized-width/rebind/
  reorder/attach/closeAll case. The completed specs contain 40 cases, but the interrupted
  spec has no final summary: exact aggregate iOS pass/skip totals are unknown.
  Maestro was skipped. Full iOS acceptance remains incomplete, with a known failure.
- A signed Release app built with Xcode 26.6 opens on a physical iPhone. Human feedback
  confirms haptics On works and ios26 + Auto works; Default + Auto is silent as expected.
  The tested app's commit and device/OS details still need to accompany that evidence
  before it can establish commit-specific acceptance for `411719a`.
- Haptics Off and Reduce Motion remain unconfirmed. The report does not establish
  all edge/repeated-crossing, lifecycle, or RTL checks in the checklist below.
  Keep the remaining automated and human acceptance gates open.

## Physical iPhone acceptance checklist

Use a newly built app from the current integrated PR commit, not the earlier owner-tested
app or combined APK/simulator build. Record fresh results against that exact commit.
In the example config panel choose Two-sided, then its Options tab.

1. With appearance default and haptics auto, compare motion and confirm no new impact.
2. Enable ios26. Drag each physical edge across its opening threshold: expect one
   light impact and a subtle pop. Oscillating across the threshold in the same
   gesture must not produce repeated impacts. A new gesture may produce one again.
3. Set haptics off: the preset remains visual only. Set appearance default and
   haptics on: threshold feedback remains available without the optional pop.
4. Use ref/static opens and closes, auto-close, recycling, and detach/attach. These
   operations must not create additional threshold impacts or leave scaled rows.
5. Enable iOS Reduce Motion, including while the demo is mounted. Entry/pop scaling
   must stop without disabling swipes or changing the chosen haptic preference.
6. Repeat with left/right actions, multiple inset buttons, and RTL. Confirm target
   sizes, readable labels, row content, and reveal widths remain intact.

Record device/OS, tested commit, Reduce Motion setting, results, and any visual or
tactile mismatch. Keep this PR draft until automated checks and the human check
are complete; a human check of a different commit must be labelled accordingly.
