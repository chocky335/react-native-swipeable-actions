# E2E harness

The mobile suites exercise the demo through WebdriverIO and Appium. The command
ownership regressions exercise the installed test framework and HTTP transport
offline; they do not replace Android, iOS, or physical-device acceptance.

## Offline harness checks

From the repository root, after installing the repository dependencies:

```sh
npm --prefix e2e ci
npm --prefix e2e run test:harness
```

The ordinary CI test job runs these regressions, even when the optional mobile
jobs are disabled. CI uses Node.js 24. The tests use mocked transport or an
in-memory connector, not a handset or a live Appium server.

## Registering mobile tests

Use the local registration adapter for tests and lifecycle hooks. Keep `describe`
as the framework-provided global, and write async/promise-based callbacks:

```ts
import { beforeEach, it } from '../helpers/scoped-mocha'

describe('Example', () => {
  beforeEach(async () => {
    // Prepare the demo using the configured driver.
  })

  it('preserves the expected behavior', async () => {
    // Exercise the UI and assert its observable behavior.
  })
})
```

The adapter also exports `before`, `afterEach`, and `after`. It wraps the original
callback before WebdriverIO captures it, so internal retries receive separate
command ownership. Do not bypass it with global test/hook registrations in new
specs. Both platform configurations also load the root-hook plugin and request
guard. A throwing `beforeCommand` hook alone is not a replacement: WebdriverIO
can catch errors from that hook without stopping HTTP dispatch.

## iOS native observations

The two-sided and RTL suites use fresh XCUITest expanded responses to read row
geometry and control rectangles. Android retains the direct element-read path.
These helpers change only E2E observation overhead, not library behavior or API.

- Each observation captures, changes, confirms, restores, and confirms Appium
  response settings under the existing command-owner guard. Readers share a
  per-driver lock and reject further observations if restoration is unconfirmed.
- Exact names, unique native references, rectangles, raw layout text, and row
  bindings are validated. Geometry is never cached across gestures or lifecycle
  changes, and malformed results do not silently fall back to another reader.
- Control navigation retains native visibility checks, normal WDIO click and
  stale-element recovery, the original gesture budget, and original deadlines.
  Replacement elements trigger fresh viewport geometry before scrolling.
- `npm --prefix e2e run test:harness` includes parser, navigation, shared-settings,
  timeout-isolation, and real installed WDIO recovery regressions. Transport
  fixtures block external networking; no handset or simulator is required.

## Timing, geometry, and failure evidence

- Sample an element's rectangle once when both its location and size are needed.
  Keep the sample local to that observation; read it again after UI changes or on
  the next poll. Do not reduce assertions or cache geometry across mutations.
- Keep the existing 120-second test and 45-minute job budgets. A partial run is
  not acceptance, and increasing deadlines is not a substitute for diagnosis.
- A failed or expired attempt loses permission to send commands. Evidence
  callbacks also have bounded, revocable ownership; remote evidence is not
  guaranteed after the enclosing deadline.
- Aborting a client request does not prove that Appium stopped an accepted
  command. Unknown outstanding work quarantines the worker's session. Subsequent
  commands, including remote evidence and cleanup, must not reuse that session.
- A proven connection refusal before a request can reach the server may use the
  configured retry policy. Ambiguous transport failures are not equivalent to
  that safe pre-acceptance case.
- Quarantine is a failure, not a skip or a pass. Local outcome recording remains
  available, but screenshots, page source, and device-preference restoration can
  be unavailable. Inspect and restore the intended device state before another
  device run; do not assume failed cleanup restored it.

When reporting mobile CI, identify the tested commit and separate recorded
passes, failures, skipped checks, and unfinished cases. Missing result records
are not zero failures. Keep physical haptic observations separate from simulator
and mocked-transport results.

Run mobile checks only against the intended simulator or explicitly authorized
handset, following its device-session rules. The offline harness command above
does not authorize connecting to or changing any device.

## Isolated iOS CI coverage

The opt-in iOS E2E workflow runs performance, RTL, single-side swipeable regression, and two-sided specs in separate jobs with matrix fail-fast disabled. Each job retains the 45-minute limit; test assertions, retries, and per-test deadlines are unchanged. The swipeable shard also runs the required Maestro seekbar regression.

The final `e2e-ios` gate requires all four jobs to succeed, all 59 registered cases to pass exactly once, completed workers, and successful Maestro coverage. Missing, cancelled, skipped, duplicate, failed, or unfinished evidence fails the gate. Artifacts are separated by source SHA, workflow run, attempt, and shard. Registration discovery rejects inventory changes until the reviewed expected spec counts are updated.

Run `cd e2e && npm run test:harness` for the offline shard-evidence regressions alongside the existing harness tests. Offline success does not establish simulator acceptance. Job isolation prevents one serial run from leaving later suites unstarted; it does not change or excuse individual test timeouts.

## Upcoming 1.0.0 API migration

The demo now uses explicit physical-side content/width pairs for every row. The original
25 cases in `swipeable.spec.ts` remain, alongside 19 two-sided, 14 RTL and one benchmark
case. Maestro's seekbar flow is unchanged. No hook, retry, polling or deadline is relaxed.

The fallback-precedence case now tests alternate explicit right content and its disabled
edge. The former legacy-only RTL mode is explicit right-only. Technical control IDs remain
stable, but labels describe the new modes; `legacy` in the alternate action's selector is
only an existing test ID, not an accepted prop or fallback path. Press-counter text uses
`alternate` with unchanged expected counts.

Migrated single-side rows intentionally adopt the canonical engine's disabled-edge,
state-callback and instant-close/cache behavior. See
[the intentional behavior changes](../docs/migration-v1.md#intentional-behavior-changes).
Historical runs do not establish acceptance of this upcoming release.
