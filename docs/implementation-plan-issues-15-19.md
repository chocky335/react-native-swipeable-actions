# Implementation plan: independent swipe actions and iOS-inspired feedback

Status: planning only. No production implementation or test execution performed.
Prepared on 2026-09-08 against the local 0.1.6 source.
Implementer: Spark, one bounded work packet at a time.
Reviewer and integration owner: the parent agent.

## Outcomes and delivery order

1. Implement [issue #15](https://github.com/chocky335/react-native-swipeable-actions/issues/15): independent left and right action content, independent widths, and side-specific completion callbacks.
2. Review and validate the complete two-sided implementation before starting appearance work.
3. Implement [issue #19](https://github.com/chocky335/react-native-swipeable-actions/issues/19): an explicitly enabled iOS-inspired appearance, native haptics, and a zoom/pop effect.

Deliver these as two independently reviewable changes. Issue #19 specifically requests the Mail/Notes feel, haptics, and pop animation; static rounded corners alone do not satisfy it. Its text does not specify exact animation parameters or provide a visual reference, so describe the initial result as iOS-inspired, not exact system parity.

Planning assumptions: physical left/right edges; one action side per gesture; shared existing friction, threshold, and auto-close settings. Full-swipe action execution, per-side physics settings, new dependencies, and automatic OS-based appearance changes are outside this implementation.

## Existing behavior that constrains the design

- `src/Swipeable.tsx` lazily mounts one actions subtree and exposes ref/static commands through the recycling-key registry. Ref commands without a key currently warn and have no effect.
- `src/Swipeable.types.ts` exports interfaces that consumers can extend or use in wrappers and mocks. `SwipeableProps.actions` and `actionsWidth` are currently required.
- `SwipeableView` and its types are public exports. Existing direct users pass one content child, or actions followed by content.
- Both native view implementations assume one action view. iOS identifies children by their count and position; adding a third child requires an explicit layout protocol.
- Both native caches store a Boolean, which cannot distinguish left-open from right-open.
- On iOS, state-change events can occur while dragging across a threshold. Preserve measured callback sequences rather than treating the README's shorter description as the complete behavior specification.
- Auto-close deliberately reports `onSwipeEnd('open')` after returning the row to its closed position. This is used by the chat reply example.
- The exported Jest setup eagerly fires swipe start. It cannot prove lazy mounting without a separate controllable test mock.
- Existing Swift package tests compile physics/configuration sources, explicitly excluding the UIKit view and Expo module. Passing them does not prove that the iOS component compiles or works.
- Actual build settings currently specify iOS 13.4 and Android API 23 defaults. Do not raise those settings, Swift/Kotlin requirements, or the declared React/Expo peer requirements for either feature.

## Compatibility contract

- All currently valid legacy JSX, exported legacy interfaces, callback argument lists, and ref/static calls remain supported.
- Legacy-only rows retain the single-side layout path, defaults, lazy rendering, action test IDs, physics constants, and native command names/arities.
- Aggregate callbacks continue receiving exactly their existing arguments: no arguments for start, one state for state/end, and one clamped number for progress. Do not add an extra direction argument to their invocation.
- Retain `open()`, `Swipeable.open(key)`, `close(animated?)`, `Swipeable.close(key, animated?)`, and `closeAll(animated?)`, including the current key requirement.
- Keep Boolean `isOpenByKey` available with its existing return type. Add a separate side query instead of changing that return type.
- Do not silently repair unrelated legacy quirks. Record any baseline failures and isolate fixes for reviewer assessment.
- Native additions require an application rebuild. An old JavaScript bundle must continue to work with the new native implementation. Using new props against an old native binary is not supported; missing new commands should produce the existing structured error handling, not silently open the wrong side.

## Public API to implement

```tsx
<Swipeable
  recyclingKey="message-1"
  leftActions={<ReplaceAction />}
  leftActionsWidth={80}
  rightActions={<DeleteAction />}
  rightActionsWidth={120}
  onLeftSwipeEnd={(state) => handleReplaceSwipe(state)}
  onRightSwipeEnd={(state) => handleDeleteSwipe(state)}
>
  <MessageRow />
</Swipeable>

ref.current?.open('left')
Swipeable.open('message-1', 'right')
```

- Export `SwipeSide = 'left' | 'right'`.
- Add optional side props and the two optional side-end callbacks. A side names the revealed edge: positive translation reveals left actions, negative translation reveals right actions. Do not automatically swap these meanings in RTL.
- Extend high-level `SwipeableMethods.open` to `(side?: SwipeSide) => void` and `SwipeableStatic.open` to `(key: string, side?: SwipeSide) => void`. Existing argumentless implementations/mocks must remain assignable. Add no new required ref methods.
- Preserve the existing exported `SwipeableProps` interface and its required legacy members. Add `TwoSidedSwipeableProps` for calls without legacy actions and `SwipeableComponentProps` for the full accepted input union.
- Expose the component with legacy and new call signatures. Keep the legacy signature last for legacy `ComponentProps<typeof Swipeable>`/`ComponentRef` inference; publish the full input union for consumers explicitly adopting both modes. Lock this with type fixtures before implementation.
- Type fixtures must include an interface extending `SwipeableProps`, existing `forwardRef` wrappers, old `SwipeableMethods`/`SwipeableStatic` objects, and existing reads of required `actionsWidth`. Do not solve typing difficulties with `any` or by making the legacy required fields optional.
- New side-content configurations must have corresponding widths. Express valid combinations in the new type where practical and validate runtime inputs as well. Null/false are supported explicit disabling values, not enabled action content.

## Resolution rules

Implement a pure `src/resolveSwipeableActions.ts` helper, used by the wrapper and tested with a table of cases.

| Input | Result |
| --- | --- |
| Only legacy `actions` and `actionsWidth` | Existing path, using `actionsPosition` or its current default of right |
| Legacy props plus a complete opposite-side pair | Both edges enabled; legacy side keeps its content and width |
| Complete explicit pair on the legacy edge | Explicit content and width replace the legacy pair on that edge |
| Side content omitted or `undefined` | Fall back to legacy content only when legacy maps to that edge |
| Explicit side content `null` or `false` | Disable that edge, including legacy fallback on that edge |
| Explicit side content without a finite positive width | Development warning and disabled edge; no fallback to a different action |
| Side width supplied without explicit side content | Ignore that width and warn; do not reinterpret the legacy pair |
| Neither side enabled | Render content and ignore open gestures/explicit open commands |

Do not use general truthiness to classify React nodes: numeric zero is valid rendered content. Never infer action count or auto-measure widths. Widths are total reveal distances in React Native layout units.

Legacy-only input retains its existing validation behavior. New validation applies to the new configuration mode. Emit warnings for configuration changes, not every render or animation frame.

For no-argument high-level `open()` in the new mode, use `actionsPosition` if that edge is enabled, otherwise the only enabled edge. When both are enabled and the position was omitted, the current right default wins. An explicit request for a disabled edge is a no-op and must not open another edge.

## Native contract, frozen before worker edits

- Keep the current native `open`, `openByKey`, `close`, `closeByKey`, `closeAll`, and `isOpenByKey` entries unchanged.
- Add module functions `openByKeyOnSide(key, side)` and `getOpenSideByKey(key) -> 'left' | 'right' | null`. Route only explicitly sided high-level opens through the new command. No native ref API expansion is required for this release.
- Add native props `twoSided` (default false), `leftActionsWidth`, and `rightActionsWidth`. The wrapper sends resolved widths, including zero for disabled edges. Existing raw `SwipeableViewProps.actionsWidth` remains required; the wrapper supplies zero in the new layout mode.
- In the new layout mode, direct native children are always `[leftSlot, rightSlot, content]`. Keep two lightweight keyed slot shells mounted with `collapsable={false}`; their expensive React action children remain lazy. The legacy mode retains its old one/two-child arrangement.
- Reconcile roles on insertion, removal, reattachment, layout, and mode changes. Defer assignments when a prop/child transaction is incomplete; never temporarily treat a left/right rail as row content. Do not reparent Fabric-owned children.
- Add the internal bridge event `onActionsNeeded` carrying `{ side }`. Emit it when a side's content is needed for a gesture, programmatic open, or restoration. The JS handler is idempotent and does not call the user's `onSwipeStart`.
- Existing progress/state/end native payloads may gain an optional `side` field. Keep their existing fields and units intact. Existing start events and the public aggregate callback arity remain unchanged.
- Keep hidden rails non-interactive and excluded from accessibility traversal. Update visibility and hit testing when sides change, even if their React children were mounted by an earlier gesture.

`onActionsNeeded` separates rendering from user gesture callbacks. It prevents programmatic opens/restoration from depending on fake user starts. Repeated native requests may be deduplicated, but must be requestable again after recycling or slot-content reset.

## Gesture and state model

Use native state equivalent to `closed | open(left) | open(right)`, plus a separate active gesture/animation side. The cache stores only settled/target open side, not a transient drag offset. The aggregate open/closed event state remains unchanged.

| Situation | Required behavior |
| --- | --- |
| Closed row begins an enabled horizontal gesture | Choose and latch the revealed edge once the existing activation distance is crossed |
| A row is already open | Latch its current edge while dragging it open/closed |
| Gesture passes back through zero | Clamp at closed; opening the opposite edge requires a new gesture |
| Gesture points at a disabled edge | Leave the row closed and preserve child/vertical gesture handling |
| Release | Use the latched edge's width, threshold, friction, and current-open state with existing single-side physics semantics |
| Completion at zero | Retain the latched edge in event metadata until its completion callback has been emitted |
| Explicit programmatic open of the opposite edge | Close the current edge, then open the requested one; report the close completion and subsequent open completion to their respective side callbacks |
| Same-edge programmatic open | Follow the existing open behavior; do not add haptics or fabricate a gesture start |

Latching is intentional for the first release: each edge can be opened independently, and a closing gesture cannot accidentally become an opposite destructive-action gesture. Document it in the new usage section.

Do not replace relative gesture displacement with absolute row translation in existing snap helpers. Account for the starting-open state exactly once. Tests must cover unequal widths, start offsets, velocity sign, friction, and threshold boundaries. Mirror pure decision test vectors between Swift and Kotlin.

For every native end event, invoke the aggregate JS end callback once and then the matching optional side callback once. No callback fires for the other edge. Side callbacks add information; they do not automatically execute a user's action.

Preserve auto-close's gesture semantics: the cache ends closed, progress ends at zero, and the final end event reports `open` with the edge that triggered it. Interrupted/disabled/recycled gestures must not retain an auto-close override for a later operation. Characterize existing programmatic-open plus auto-close behavior in packet A and preserve it; the new side argument must not introduce a separate auto-close policy.

## Recycling, asynchronous work, and live props

- Replace Boolean cache values internally with nullable/open-side state while retaining existing bounded storage and registry threading behavior. `isOpenByKey` derives a Boolean from that state.
- Restore the matching side and width. JS initializes lazy content from `getOpenSideByKey` for the new mode; the legacy initialization continues using its Boolean query.
- Preserve both cache identity and the view registry through FlatList/FlashList reorder and detach/reattach. Do not let old-view unregister work remove a replacement view registered under the same key.
- Tag delayed auto-close work, restore work, and close-then-open continuations with the recycling key/configuration generation. Ignore stale work after rebind, interruption, disable, or unmount.
- On a genuine rebind, cancel active work, reset both rail transforms, and restore only the new key's cached edge. If that edge is unavailable, restore closed; do not map it to the opposite edge.
- In the new mode, removing the active side or setting its width invalid resets the row closed without synthesizing user callbacks. Clear its cached side and pending work. Preserve legacy prop-change behavior in the legacy path.
- For a positive width change in the new mode, settle an open row at the new width. During an active gesture/animation, cancel and reconcile to the current logical open/closed state using the new width. Do not leave an offset outside the current configuration.
- Apply related prop updates coherently before restoring state, rather than reacting irreversibly to an intermediate setter order.
- Keep action content lazy per edge, and reset/synchronize that rendering state when the recycling key changes. Returning a previously opened edge must not expose stale action content from another item.

## Spark work packets and review gates

Execute A first. B and C can run concurrently only with separate workers and disjoint native file ownership. With one Spark worker, run B then C. D requires both native packets. E is the integration gate for issue #15. F starts after E passes parent review.

| Packet | Owned files | Required output and parent review |
| --- | --- | --- |
| A. Baseline and compatibility fixtures | `src/__tests__/Swipeable.test.tsx`, `src/__tests__/SwipeableView.test.tsx`, new `src/__tests__/helpers/createControlledNativeMock.tsx`, new `src/__type_tests__/legacy-api.tsx`, new `tsconfig.compatibility.json` | Characterize legacy defaults, mounting, exact callback arguments, ref/static command routing, and auto-close event handling using controlled native events. Type-check real consumer fixtures separately from Babel/Jest. Capture native event traces with the example app when available. Parent freezes expected behavior and identifies pre-existing failures. |
| B. iOS two-sided core | `ios/SwipeableView.swift`, `ios/SwipeableModule.swift`, `ios/SwipePhysics.swift`, `ios/Tests/SwipePhysicsTests.swift` | Implement the frozen bridge, slots, latched-side decisions, cache, restoration, and cancellation. Preserve legacy entry points and physics helpers. Parent reviews child-role changes, event timing, cache lifecycle, and main-thread use; Swift physics tests plus actual example-app native compilation are required. |
| C. Android two-sided core | `android/src/main/java/expo/modules/swipeable/SwipeableView.kt`, `SwipeableModule.kt`, `SwipePhysics.kt` in the same directory; `android/src/test/java/expo/modules/swipeable/SwipePhysicsTest.kt`; new `android/src/test/java/expo/modules/swipeable/SwipeableViewTest.kt` | Implement the same bridge/state contract. Convert each width to pixels once at the native boundary; preserve existing event units. Cover cancellation of springs, visibility, touch interception, attach/detach, and registry behavior. Parent compares Swift/Kotlin decision vectors and reviews density and lifecycle handling. Use existing Robolectric support for meaningful view regressions. |
| D. React API and integration | `src/Swipeable.types.ts`, `src/Swipeable.tsx`, `src/SwipeableView.tsx`, `src/SwipeableActions.tsx`, `src/nativeModuleUtils.ts`, `src/index.ts`; new `src/resolveSwipeableActions.ts`; corresponding `src/__tests__` files; new `src/__type_tests__/two-sided-api.tsx` | Implement overloads, resolver, stable/lazy slots, event routing, and command helpers. Parent checks complete old/new input combinations, old native calls unchanged, type assignability, first programmatic open, and reuse by key. Extend the published `jestSetup.js` with additive module stubs only; preserve its existing eager-start behavior and use the private controlled mock for behavior tests. |
| E. Example, E2E, and documentation | New `example/screens/TwoSidedScreen.tsx`; `example/App.tsx`, `example/components/ConfigPanel.tsx`, `e2e/pages/configPanel.ts`, `e2e/helpers/selectors.ts`, new `e2e/specs/two-sided.spec.ts`, `README.md` | Add a separate selectable demo with unequal widths, action counters, commands, recycling, and configuration changes. Keep existing list/chat demos and selectors intact. Add integration tests and documentation for precedence, edge meaning, callbacks, key requirements, and native rebuilds. Parent reviews the complete patch and observes both platforms before accepting issue #15. |
| F. Opt-in appearance and feedback | `src/Swipeable.types.ts`, `src/Swipeable.tsx`, `src/SwipeableView.tsx`, `ios/SwipeableView.swift`, `ios/SwipeableModule.swift`, `ios/SwipeAnimationConfig.swift`, `example/screens/TwoSidedScreen.tsx`, `e2e/specs/two-sided.spec.ts`, relevant JS tests, `README.md` | Implement the preset described below after issue #15 review. Parent reviews real visuals/haptic evidence, reduced-motion handling, transform composition, and unchanged default rendering. |

File ownership is a boundary, not permission for broad cleanup. If a necessary file lies outside a packet, Spark reports the dependency to the parent before expanding the edit. New pure Swift source files would also require `ios/Package.swift` updates; prefer keeping decision helpers in the existing physics source for this implementation.

For every packet, Spark returns changed paths, a concise behavior summary, commands and actual results, remaining failures/blockers, and any deviation from this contract. The parent reads the patch, reports findings with file/line references, and sends narrowly scoped corrections back to the worker. A worker's successful self-report is not final review approval.

## Appearance packet specification

- Add `appearance?: 'default' | 'ios26'`, defaulting to `default`. Enable the new effect only when explicitly requested. In the first release Android retains its existing presentation when this iOS preset is selected; document and test that fallback.
- Add `hapticFeedback?: boolean`. Omitted means enabled only for the explicit iOS preset; false disables it. Explicit true opts into threshold haptics on iOS even with default appearance. Default legacy usage must produce no new feedback.
- Use native UIKit feedback APIs available within the current deployment/toolchain requirements. Prepare feedback at gesture activation and emit one light impact at the first opening-threshold crossing per physical gesture. Do not emit on every frame, repeated crossings, programmatic commands, recycling, or auto-close.
- Keep scale/pop separate from translation/progress state. Compose transforms about the active action rail's center; progress updates must not overwrite the scale or scale the translated row content. Do not reparent Fabric-managed children or take control of caller action internals.
- Start with named tuning constants for an action-rail entry scale of 0.96, a maximum pop scale of 1.03, and settling at 1.0. Treat these as implementation starting values, subject to parent visual review rather than claims about Apple's values.
- Respect `UIAccessibility.isReduceMotionEnabled`, including changes while the view is mounted: suppress nonessential scale/pop and cancel an active pop back to scale 1. Preserve functional swiping and user haptic preference.
- Reset scale and feedback state on cancellation, recycling, detach, appearance changes, gesture disable, and side changes. No new per-frame JS work or React state updates for the effect.
- Build a rounded, inset action-button recipe in the example using caller-owned React nodes. Include padding and spacing in the explicitly supplied reveal width. The preset supplies native feedback/motion; it cannot automatically restyle arbitrary user-provided React content.
- Include one-action and multiple-action examples, left/right edges, light/dark surroundings, larger accessibility text, and a minimum usable button target. Existing action components and default geometry remain unchanged.
- Do not add Liquid Glass/blur dependencies, require the iOS 26 SDK, implement automatic destructive full swipe, or claim to use the system Mail/Notes control. Exact system material parity is a separate feature decision.

## Acceptance matrix

| Area | Required cases |
| --- | --- |
| Legacy source compatibility | Original JSX; `SwipeableProps` extension; required-width reads; ref wrappers; old method/static mocks; raw `SwipeableView`; legacy inferred props/ref types |
| New source compatibility | Left-only, right-only, both, mixed legacy/new, null-disabled side, callbacks, optional-sided commands, invalid missing-width cases |
| Runtime resolution | Every precedence-table row, unequal widths, zero/negative/NaN/infinite new widths, zero-valued React content |
| Lazy rendering | Neither expensive action mounts initially; chosen side mounts on first drag, explicit open, and cache restore; untouched edge stays unmounted; repeated requests do not duplicate mounts |
| Gestures | Slow/fast open/close both sides, wrong-edge gesture, activation offset, threshold boundary, friction, velocity sign, open-row closing, cross-zero latch |
| Callbacks | Exact legacy arity/order/count; correct side-end routing; side retained at zero; auto-close reports open after visual close; no duplicate completion after cancellation |
| Commands | Old ref/static calls; explicit left/right; disabled edge; opposite-edge switch; missing key; close with/without animation; closeAll after detach/reattach |
| Recycling | FlatList and FlashList reorder, offscreen/onscreen restore of each edge, A-to-B reuse, stale timer/restore cancellation, unavailable cached edge, registry replacement |
| Live updates | Disable during drag/animation, remove active actions, resize width, switch layout mode, unmount during auto-close/opposite-side transition |
| Touch/accessibility | Press revealed actions on both edges; hidden actions untappable/unfocusable; vertical scroll; nested RNGH seekbar; keyboard preservation; physical side meaning in RTL |
| Appearance | Default screenshots/motion unchanged; opted-in pop both edges; one haptic per gesture; reduced motion; interruption; Android fallback |
| Performance | Compare same device/build/list workload; no additional per-frame React renders; unopened edge content remains lazy; legacy layout has no extra slot shells; investigate repeatable frame-time regressions |

Tests must exercise observed outcomes and event delivery. Manually invoking a callback assigned to a props object, checking an export exists, or passing physics tests alone is insufficient evidence for these changes.

## Validation commands and limits

Use the repository's available tooling during execution, not during this planning task:

```sh
npm run typecheck
npx tsc --noEmit -p tsconfig.compatibility.json
npm test -- --runInBand --coverage=false
npm run test:ios
npm run test:android
npm run lint
npm run format:check
```

`tsconfig.compatibility.json` is added in packet A with no output and explicit inclusion of the consumer fixtures. Keep those fixtures out of the published library build and emitted declarations. The package TypeScript configuration currently excludes Jest tests, so Jest passing does not validate those test-file type assertions.

Build the example application's actual native targets before E2E. Use the existing checked-in native project/build configuration when available; do not regenerate Expo native projects or upgrade dependencies merely to run a check. Record missing SDKs, generated projects, or dependencies as environment blockers.

The E2E package's platform-specific scripts pin the old spec. Run the new spec explicitly using the relevant configuration from `e2e/`, with actual device/application paths supplied through its supported environment settings:

```sh
npx wdio run wdio.conf.ts --spec specs/two-sided.spec.ts
npx wdio run wdio.ios.conf.ts --spec specs/two-sided.spec.ts
```

Also run the existing swipeable regression spec on both platforms. The iOS configuration contains machine-specific simulator/app-path defaults; choose real available values rather than assuming those defaults work. A physical iPhone is needed to judge haptic feel; a simulator is sufficient only for dispatch/visual assertions.

Record baseline failures separately from introduced failures. Do not rewrite unrelated tests to make the suite green. A missing native build/device check remains an explicit validation gap and prevents a claim of complete cross-platform verification.

## Ready-to-use Spark handoff

```text
Implement packet <A|B|C|D|E|F> from
docs/implementation-plan-issues-15-19.md in the current repository.

Read the plan and relevant local instructions. Your edit scope is that
packet's owned files. Preserve existing user changes and the compatibility
contract. Implement the frozen decisions; report ambiguities or required
scope expansion to the parent rather than redesigning the public API.

Make the bounded changes and run the packet's relevant checks. Keep old
consumer fixtures passing and report baseline/environment failures honestly.
Return changed paths, behavior changes, actual validation results, and any
remaining risks or deviations. Do not publish, merge, release, or post issue
comments. Stop after this packet so the parent can review and assign the next.
```

The current sub-agent tool's advertised model overrides do not include Spark. Keep this handoff ready for a session where Spark is selectable; do not silently substitute a different model or create a separate user-facing task. No sub-agent was launched for this plan.
