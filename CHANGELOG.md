# Changelog

User-facing changes are recorded here before release. Entries under **Unreleased**
are not available in a published version unless explicitly stated otherwise.
GitHub Release notes should use the matching version's entry from this file.

## Unreleased - upcoming 1.0.0

### Independent two-sided actions ([#15](https://github.com/chocky335/react-native-swipeable-actions/issues/15), [PR #21](https://github.com/chocky335/react-native-swipeable-actions/pull/21))

#### Added

- Independent `leftActions` and `rightActions`, with `leftActionsWidth` and
  `rightActionsWidth`, on the same row.
- Side-specific `onLeftSwipeEnd` and `onRightSwipeEnd` completion callbacks.
- Physical-side selection for ref and static `open` commands, with keyed side
  restoration and lazy action mounting for all rows.

#### Fixed

- Physical-edge action alignment in RTL layouts.
- Two-sided action state handling during recycling, width changes and row reuse,
  including protection against stale commands affecting a reused row.

#### Breaking changes and migration

- Remove `actions`, `actionsWidth`, and `actionsPosition`. Replace the right/default
  legacy pair with `rightActions`/`rightActionsWidth`, or the left pair with
  `leftActions`/`leftActionsWidth`. Mixed legacy fallback is no longer supported;
  select explicit content in the caller.
- `SwipeableProps` is the canonical explicit-side type. `TwoSidedSwipeableProps`
  and `SwipeableComponentProps` alias it, rather than accepting an old/new union.
- Migrated single-side rows adopt the canonical engine's disabled-edge handling,
  state callbacks, and close/cache behavior, not old
  wrong-direction rubber-banding or incidental close/restore callback sequences.
- Ref/static methods and callback signatures remain unchanged. No-argument
  `open()` chooses enabled right, otherwise enabled left. Use an explicit side
  when the caller needs a particular edge.
- Left and right remain physical edges. Labels and explicit widths can update
  live; changing global React Native layout direction requires an app restart.
- Rebuild both native targets when upgrading. This is an upcoming major release,
  not a statement that 1.0.0 has been published.

The shared native three-slot layout and internal side/key routing metadata are
implementation details, not new consumer props or public callback arguments.

### Optional iOS appearance and haptics ([#19](https://github.com/chocky335/react-native-swipeable-actions/issues/19), [PR #22](https://github.com/chocky335/react-native-swipeable-actions/pull/22))

This is the second delivery, additive to the breaking explicit-only 1.0.0 base above.
It has not been released separately or as part of the first delivery.

#### Added

- Opt-in `appearance="ios26"` for iOS-inspired action entry/pop motion on iOS,
  usable with an explicit single-side pair or both explicit sides.
- Optional `hapticFeedback` boolean for native opening-threshold feedback on iOS.
  When omitted, feedback is enabled for `ios26` appearance and disabled for
  `default`. Explicit `true` or `false` overrides that default; the demo's Auto
  setting means the prop is omitted, not a new API value.
- Reduce Motion handling for the optional entry/pop scaling without overriding
  the chosen haptic preference or disabling normal row translation.

#### Appearance on the breaking 1.0.0 base

- Appearance adds optional props to the new API; it does not restore the removed
  legacy props or behavior. Default appearance preserves the base presentation.
  The preset is opt-in, not automatically enabled by the installed iOS version.
- Android retains the new base's native motion; these options add no Android
  haptics or presentation effects.
- This is an iOS-inspired presentation, not native Mail/Notes or Liquid Glass
  integration. Rounded/inset buttons remain caller-owned styling.

## Earlier releases

This changelog starts with the work above. Earlier versions have not been
retrospectively documented here; an absent entry does not imply an absent release.

## Maintaining this file

See [the release checklist](https://github.com/chocky335/react-native-swipeable-actions/blob/main/docs/releasing.md). Test logs, CI status and unfinished
acceptance checks belong in PR descriptions and implementation notes, not in
published release notes.
