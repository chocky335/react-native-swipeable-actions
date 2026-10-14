# Changelog and release checklist

## Source of truth

`CHANGELOG.md` is the user-facing release history. Keep new entries in `Unreleased`
until the corresponding changes are merged and an actual release is being prepared.
Use the same version entry for GitHub Release notes rather than generating a second,
potentially inconsistent summary from commit titles.

- Describe changes users can act on: new APIs, changed behavior, fixes, platform
  limitations and migration requirements.
- Preserve existing API defaults unless a breaking change is explicitly approved.
  Call out any breaking change and its migration instructions prominently.
- Link the relevant issue and PR. Do not include local paths, device identifiers,
  credentials, internal debugging logs or claims that incomplete tests passed.
- Keep test evidence and remaining gates in the PR and implementation notes.
- Add a changelog entry with a user-facing change. Documentation-only corrections
  and internal refactors do not need release-note noise unless they affect users.

## The current stacked deliveries

1. PR #21 targets `main` and delivers issue #15. Its changelog diff must contain
   only the two-sided actions delivery and the shared changelog convention.
2. PR #22 initially targets PR #21's branch. Its incremental changelog diff adds
   only the optional appearance/haptics delivery for issue #19.
3. Merge #21 first and retarget #22 to `main`. Keep both PRs' notes in their own
   focused commits; do not mix release bookkeeping into unrelated UI or test edits.
4. If the deliveries ship in separate versions, move only the first delivery into
   the first version entry. Keep the second under `Unreleased` until it ships.
   If they ship together, preserve both clearly named sections in that version.

No version number, release date or release order beyond this dependency is assigned
by these draft notes. Avoid duplicate entries when the stacked PR is retargeted.

## Before publishing

1. Confirm the intended changes are merged into `main`, reviewed, and accepted on
   the exact release revision. Resolve required CI failures, timeouts and device
   acceptance gaps; a cancelled job is not a pass.
2. Choose the version bump deliberately. Do not infer the release version solely
   from the existence of an additive feature, especially while the package is
   still on a `0.x` version.
3. Finalize the relevant `Unreleased` content under `## <version> - YYYY-MM-DD`,
   using the agreed version and release date. Leave a new `Unreleased` section
   for subsequent work, and retain any changes not included in this release there.
4. Review and commit the release notes. Check that the selected version bump will
   produce exactly the version named in the notes. Coordinate release preparation
   so another version bump cannot invalidate that decision.
5. Run the existing **Publish to npm** workflow from `main` with the approved bump
   type. It runs its configured tests, performs `npm version`, builds, publishes,
   and pushes the version commit/tag. **Do not also bump the package manually**:
   the current workflow owns that step.
6. Confirm the npm version, dist-tag and pushed Git tag match the intended release.
   Create the GitHub Release for that tag using exactly the corresponding changelog
   section. The current workflow does not create GitHub Releases automatically.

The publishing workflow skips E2E via `SKIP_E2E=1`. Its test step does not replace
the full platform CI and manual acceptance required before release. This checklist
does not itself authorize publishing, merging, version changes or history rewrites.

## Prereleases and interrupted publishes

- The workflow's `prerelease` option uses the `canary` prerelease identifier and npm
  dist-tag. Clearly label its release notes as a prerelease; do not present its
  changes as a completed stable release.
- Do not blindly rerun a failed publish. Publishing to npm happens before the tag
  push, so a workflow can fail after the package is already published. Check npm
  and Git state first; published package versions cannot simply be overwritten.
- If no release was published, correct the draft notes before retrying. Never
  remove or rewrite the historical notes for an already-published version to hide
  a failure or missing change.

## Automation boundary

This adds documentation and packages the changelog; it does not alter the current
publishing workflow. A future automation change can enforce changelog finalization
and create draft GitHub Releases from the version entry. Such a change should be
reviewed separately from the library features because it changes release behavior.
