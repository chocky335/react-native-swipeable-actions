# Issue 19: optional iOS-inspired appearance and haptics

## Stacked delivery

This follow-up to issue 15 addresses
[issue 19](https://github.com/chocky335/react-native-swipeable-actions/issues/19).
Its PR is based on the issue-15 branch until that delivery merges, then can be
retargeted to main. Review this PR against its selected base to see only the
appearance changes, not the independent two-sided implementation.

`appearance="ios26"` opts into native iOS rail entry/pop motion. The default keeps
the previous presentation. `hapticFeedback` explicitly enables/disables one native
light impact at the first opening-threshold crossing in a gesture; when omitted,
the appearance preset determines the default. Programmatic opens, remounts,
recycling, and auto-close do not synthesize a new threshold impact.

This is iOS-inspired motion, not Apple's native Mail/Notes control, Liquid Glass,
or a claim of exact system-control parity. Rounded/inset/multiple buttons remain
caller-owned React content. No new blur dependency, SDK minimum, or Android motion
change is introduced. The physical-side and RTL contracts of issue 15 remain intact.

## Automated checks

The separate change restores seven Swift appearance/feedback tests and two React
prop/default/platform tests. The two-sided E2E styling case additionally exercises
the preset and explicit haptic options while retaining reveal-width and tappability
assertions. All legacy, two-sided, RTL, and benchmark cases must still run.

Swift package tests exclude UIKit; a successful native app build and full iOS E2E
run are required. Simulator tests cannot establish physical haptic feel. Fresh,
commit-specific results belong in the PR, not in claims derived from the older
combined branch.

## Physical iPhone acceptance checklist

Use a newly built app from this PR, not the earlier combined APK/simulator build.
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
