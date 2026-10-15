# Changelog

User-facing changes are recorded here before release. Entries under **Unreleased**
are not available in a published version unless explicitly stated otherwise.
GitHub Release notes should use the matching version's entry from this file.

## Unreleased

### Independent two-sided actions ([#15](https://github.com/chocky335/react-native-swipeable-actions/issues/15), [PR #21](https://github.com/chocky335/react-native-swipeable-actions/pull/21))

#### Added

- Independent `leftActions` and `rightActions`, with `leftActionsWidth` and
  `rightActionsWidth`, on the same row.
- Side-specific `onLeftSwipeEnd` and `onRightSwipeEnd` completion callbacks.
- Physical-side selection for ref and static `open` commands, with keyed side
  restoration and lazy action mounting for two-sided rows.

#### Fixed

- Legacy action alignment in RTL layouts, so actions remain on the requested
  physical edge.
- Two-sided action state handling during recycling, width changes and row reuse,
  including protection against stale commands affecting a reused row.

#### Compatibility

- Existing single-sided props, callback signatures and argumentless `open()`
  remain supported. No migration is required for existing usage.
- Left and right mean physical edges, not language-dependent leading/trailing
  edges. Translated labels and explicit action widths can update live; changing
  global React Native layout direction still requires an app restart.

### Optional iOS appearance and haptics ([#19](https://github.com/chocky335/react-native-swipeable-actions/issues/19), [PR #22](https://github.com/chocky335/react-native-swipeable-actions/pull/22))

This is the second delivery, stacked on the two-sided actions PR. It has not been
released separately or as part of the first delivery.

#### Added

- Opt-in `appearance="ios26"` for iOS-inspired action entry/pop motion on iOS,
  usable with both legacy and two-sided rows.
- Optional `hapticFeedback` boolean for native opening-threshold feedback on iOS.
  When omitted, feedback is enabled for `ios26` appearance and disabled for
  `default`. Explicit `true` or `false` overrides that default; the demo's Auto
  setting means the prop is omitted, not a new API value.
- Reduce Motion handling for the optional entry/pop scaling without overriding
  the chosen haptic preference or disabling normal row translation.

#### Compatibility

- The default appearance and existing public API are unchanged. The preset is
  opt-in, not automatically enabled by the installed iOS version.
- Android retains its existing native motion; these options add no Android
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
