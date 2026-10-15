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

## Earlier releases

This changelog starts with the work above. Earlier versions have not been
retrospectively documented here; an absent entry does not imply an absent release.

## Maintaining this file

See [the release checklist](https://github.com/chocky335/react-native-swipeable-actions/blob/main/docs/releasing.md). Test logs, CI status and unfinished
acceptance checks belong in PR descriptions and implementation notes, not in
published release notes.
