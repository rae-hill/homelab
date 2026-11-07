# Remote Printing Feature — Progress Log

Handoff log for agents. Newest entries at the top. Read `README.md` + `plan.md` first.

---

## 2026-11-06 — Session 6 (PuppeteerService extraction DONE; Effect v4 fiber/scope/queue bug ROOT-CAUSED FROM SOURCE)

Picks up from the previous session's WIP (uncommitted `PuppeteerService` extraction that
failed e2e with a 503 InterruptError). This session: source-verified the failure model in
`repos/effect` + installed `effect@4.1.2`, redesigned the log-queue lifecycle, shipped,
full validation green, committed. The old handoff doc
(`puppeteer-refactor-handoff.md`) is deleted — its knowledge lives below.

### The bug — complete source-backed model (expensive knowledge; do NOT re-derive)

The prior WIP had a `forkScoped` log-consumer fiber + a drain finalizer doing
`Queue.shutdown` → `takeAll`. Symptom: print SUCCEEDED (211KB %PDF) but the request died
with `InterruptError` → 503. Mechanism, all from `repos/effect/packages/effect/src/`:

- **`Queue.shutdown`** finalizes the queue with an _interrupt-shaped_ exit
  (`Queue.ts:1206-1217`, `exitInterrupt`) and DISCARDS buffered messages. Any later
  `take`/`takeAll` on the shut-down queue receives `state.exit` (`Queue.ts:1625-1628`,
  `2022-2023`) → **the closer fiber itself dies with Interrupt**. A failing scope close
  REPLACES a successful use-step (`internal/effect.ts:4256-4265`) → 503. (Probes A/E.)
- **`Queue.takeAll` = `takeBetween(1, ∞)` PARKS on an empty OPEN queue** until ≥1 message
  (`Queue.ts:1303`, `2047-2063`; the installed d.ts says so verbatim: "waiting until at
  least one message is available when the queue is empty", returns `NonEmptyArray`).
  Inside a scope finalizer that is an **unkillable deadlock**: finalizers run
  uninterruptibly (`internal/effect.ts:4250-4255`), and `Effect.timeout`'s kill path
  (interrupt+await, `internal/effect.ts:1744`, `971-982`) can't touch an uninterruptible
  fiber — `interruptUnsafe` merely accumulates the cause (`592-613`). This is why probe G
  hung even with NO shutdown anywhere: the outer-timeout race forks the scoped effect
  (`3961-3981`, `1751`), the dispatcher runs the consumer, the consumer empties the
  queue, the drain's `takeAll` parks forever in the inner fiber's close; the 4-min sleep
  wins but `fiberAwaitAll` never resolves. Probes F/H/H' are the same park (straggler
  `takeAll` after the consumer drained / after `Fiber.interrupt` removed the taker).
- **`forkScoped` is clean**: it registers the fiber's interrupt as a scope FINALIZER
  (`internal/effect.ts:5697-5739`); at close, `fiberInterrupt` = interrupt + await +
  **discard the cause** (`940-967`, `843-852`). A parked consumer killed at scope close
  contributes nothing to the result (probe C). The prior session's v1 hang was NOT the
  interrupt — it was the `takeAll` after it.
- Finalizers run in **reverse registration order** (`internal/effect.ts:4057-4062`);
  per-finalizer failures are captured and MERGED into the close cause (`4062`,
  `2194-2207`).
- `Effect.timeout` inside a finalizer is fine (probe D): its sleep is timer-driven and
  resumes the parked closer via the callback path — no interrupt needed.
- **The outer backstop timeout is NOT an escape hatch for scope close**: if any finalizer
  parks unboundedly, the program deadlocks regardless. The only safe discipline: no
  unbounded awaits inside finalizers.

### The fix (new `puppeteer-service.ts` lifecycle; no consumer-fiber compromise needed)

Registration order inside `withPage`'s `Effect.scoped` (⇒ unwind order):

1. **close finalizer** (added FIRST ⇒ runs LAST): unchanged bounded close
   (`Effect.timeout(10s)` → `Effect.catch` → SIGKILL `browser.process()`, never fails),
   straggler drain swapped `takeAll` → **`Queue.clear`**.
2. **drain finalizer** (runs SECOND): **`Queue.clear` + `Effect.forEach` run**. NO
   `shutdown`, NO `takeAll` anywhere in the codebase's finalizers anymore.
3. **`forkScoped` consumer** (added LAST ⇒ its interrupt entry runs FIRST): live
   `Queue.take` → run, `Effect.forever` — logs execute in order as they arrive; the
   queue is fully decoupled from acquire/use/release (user's ask), and the scope's own
   interrupt handling kills it cleanly (cause discarded).

`Queue.clear` (`Queue.ts:1256-1264`) is the ONLY safe drain primitive: never parks,
empty ⇒ `[]`, Done ⇒ `[]`. Safe under the outer backstop: timeout fires → use-step
interrupted → close runs uninterruptibly but interrupt-entry + clear + forEach +
bounded close all complete without parking → `TimeoutError` surfaces properly.

- **Font/request tracking is synchronous now** (user's Ref+HashSet ask, kept):
  `Ref.makeUnsafe(HashSet.empty<HTTPRequest>())`; handlers mutate
  `MutableRef.update(trackedRequests.ref, HashSet.add/remove(request))` directly —
  `Ref<A>` publicly exposes its `MutableRef` cell (`Ref.d.ts:58`) and `MutableRef`
  get/set/update are synchronous. Queue-deferred Ref updates (old WIP) would be stale at
  the font-stall decision point. Reads stay Effects: `Ref.get(...).pipe(map(HashSet.size))`.
- **Callback→Effect bridge**: `Queue.offerUnsafe` from the raw mitt/EventEmitter handlers
  — the sanctioned v4 pattern (Effect's own `Stream.fromEventListener` uses it,
  `Stream.ts:1487-1498`). Puppeteer handlers are sync, return value ignored, no
  try/catch in mitt's emit — every offered effect is `catchDefect`-guarded so a dead
  JSHandle (e.g. Formatter after a reload) can't kill the consumer or a finalizer.
- **Puppeteer fix** (from `repos/puppeteer` source): in the interception handler,
  `request.continue()` REJECTS for `data:` URLs (they skip interception but still get
  `interception.enabled`, `NetworkManager.ts:416-418`, `cdp/HTTPRequest.ts:271-275`) →
  both `abort()`/`continue()` now have `.catch(() => {})` (unhandled-rejection guard).
- `pdf-print-service.ts` is the thin domain flow (seed localStorage → goto/networkidle2 →
  print-ready selector → font-stall fallback → pdf), backstop `Effect.timeout("4 minutes")`
  - `Match` error mapping; the two temp debug logs are removed; permanent `[print]` phase
    logs kept.
- Other useful puppeteer source facts: `page.pdf()` waits for `document.fonts.ready` by
  default (`waitForFonts: true`, 30s per-call timeout, `cdp/Page.ts:1249-1334`) — the
  font-stall abort fallback is what settles it; `browser.close()` is idempotent
  (guarded by a `closing` flag) and its only unbound is protocolTimeout (180s) — hence
  the 10s Effect bound; `launch({signal})` abort SIGKILLs the whole chrome process
  group; `evaluateOnNewDocument` re-runs on every navigation (fallback reload re-seeds).

### Also shipped in this commit (from the prior WIP, kept per its handoff §6)

- **Confetti popup root cause + double fix**: the resume SPA injects
  `run.confettipage.com/here.js` with a domain-bound `data-confetticode` — on the
  tailnet mirror it errors/popups. (1) print chrome launches with
  `--host-resolver-rules=MAP run.confettipage.com ~NOTFOUND` (verified: no popup, no
  stall); (2) `CONFETTI_ALLOWED_HOSTNAMES` gate in `prod-side-effects.ts` for human
  mirror visitors — **needs a GH Pages redeploy (public site) and augustus rebuild
  (`resume-site`) to take effect; printing doesn't wait for either (DNS block covers it)**.
- **Event observability** (user ask #2): request/requestfinished/requestfailed/
  response≥400/pageerror/dialog(dismiss)/targetcreated handlers → server logs. NOTE the
  resume SPA noops `console.log` in prod builds — server-side event logging is the
  reliable channel. Debug-level lines are invisible on augustus (`LoggerLive` has no
  min-level env; follow-up if ever needed).
- `scripts/e2e.sh`: pre-start port check on :54328 (a stale server once produced a
  FALSE-GREEN suite run) + `set -m` job-control rationale comment. Do NOT "fix" with
  `setsid` (breaks `$!` and the group kill).
- Chrome Local-Network-Access note: the SPA's reachability probe from the public site to
  the tailnet API fails with `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS` — benign for
  printing (print-ready doesn't depend on it).

### Verification (all green this session)

- `yarn typecheck` ✓; `yarn lint` ✓ (0 errors; 4 pre-existing resume warnings);
  `yarn test` ✓ (600 services-node + 55 server + others).
- Full `e2e`: **14 files / 108 tests green INCLUDING the live %PDF resume-print success
  test** (`[print] pdf rendered: 211643 bytes`); `.e2e-log-dump.txt`: no
  TypeError/InterruptError/undeclared-status; spans `puppeteer-run` → `puppeteer-drain-logs`
  (87µs) → `puppeteer-close` (40ms) all completed; port 54328 free afterwards.
- Post-commit nix: `nix build .#resume-site`, `nix flake check --no-build`, shellcheck
  gate, `nix build .#homelab-api` — results noted in the commit session (see below /
  re-run if in doubt).

### What remains (ordered)

1. **User deploy**: push `main` (yubikey; agents never push) + `nixos-rebuild switch`
   augustus — picks up the whole refactor + confetti gate for the tailnet mirror.
   Public-site confetti gate needs a GH Pages redeploy (workflow runs on push).
2. Manual verification checklist (session 1 item 4) — re-run after deploy.
3. Optional polish (unchanged): silent token renew, IdP-side logout, browser pooling
   (only if print volume warrants), self-hosted Victor Mono (kills the font-stall class
   entirely; yarn.lock change ⇒ nix-hashes dance for api/ui/resume-site ×3).

### Gotchas (new / refreshed)

- **Effect v4 `Queue.takeAll` PARKS on an empty open queue** (returns NonEmptyArray) —
  nothing like v3. In finalizers/release steps use `Queue.clear` (never parks) or
  `Queue.collect` (after `Queue.end`). The COMMITTED session-4/5 code had a latent hang
  here (release-step `takeAll` only worked because response-handler offers guaranteed a
  non-empty queue); the refactor removed the last `takeAll` call sites.
- `Queue.shutdown` ≠ "stop consumers": it discards buffered messages AND poisons later
  takes with an interrupt exit that lands on the TAKING fiber (a finalizer → replaces
  the use-step's success). `Queue.end` is the typed clean stop (`Cause.Fail(Done)`,
  buffered messages stay drainable via `collect`).
- `Effect.timeout` (and any interrupt) cannot rescue a fiber parked inside its own
  uninterruptible scope close. Design finalizers to never park unboundedly.
- `forkScoped`/`forkIn` interrupt-and-discard at scope close (child cause never leaks);
  `forkDetach` leaks the fiber entirely; there is no plain `Effect.fork` in v4.
- Sync writes into a `Ref` from raw callbacks: `ref.ref` is a public `MutableRef` cell
  (`MutableRef.update/set`); `Ref.makeUnsafe`/`Ref.getUnsafe` exist; there is no
  `Ref.setUnsafe`.
- Everything from sessions 1–5 still applies: `nix develop . --command yarn …`, `git add`
  before nix eval, clean tree for `.#homelab-api`, `--no-verify` commits, never push,
  light subagent models WITHOUT variant suffixes.

---

## 2026-11-06 — Session 5 (414 root cause, localStorage seeding, resume-site tailnet vhost)

### Commits

| Commit     | What                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `231dc6c7` | pdf-print: seed config via localStorage instead of the URL (fixes GH Pages **414**); bounded `browser.close()` (10s + SIGKILL, never fails the request) |
| `d84ec7d3` | nix: `resume-site` flake package (offline vite build of packages/resume, mirrors the homelab-ui derivation, shared yarn hash)                           |
| `ff4e98ab` | nix: serve it as a **catalog vhost** `https://resume.plato-splunk.media` (tailnet) + point `RESUME_SITE_URL` at it                                      |

### Round-2 augustus failure — the REAL root cause: HTTP 414

- After deploying the font-stall fallback, print still failed. The (newly visible —
  drain-first cleanup!) page-console logs in the journal showed
  `Failed to load resource: ... 414` + `404`: the `importPrintSettings=<base64>` query
  param makes the request line too long for GitHub Pages/Fastly on REAL-WORLD configs
  (e2e fixtures are tiny, which is why every local run passed). Chrome renders GH
  Pages' 414 error page → no SPA → no `data-print-ready` → selector timeout. Round 1's
  augustus selector timeout was almost certainly the same 414 (the font-stall mechanism
  is real — reproduced locally — but may never have been what augustus hit).
- `browser.close()` also HUNG after the 414 page (trace showed the first `drain-logs`
  span and nothing after) → close is now bounded (10s race, SIGKILL last resort) and
  cleanup failures log-and-succeed so the real use-step error surfaces.

### The transport fix (no frontend redeploy needed)

- `shared/print-config/constants.ts`: `PRINT_CONFIG_LOCAL_STORAGE_KEY`
  (`"https://resume.rae-hill.dev__print-config"`) is now the shared wire contract;
  resume's constants re-export it (deployed bundle unchanged).
- `PdfPrintService` decodes the edge-validated config base64 to its JSON form and seeds
  it into the site's localStorage via `page.evaluateOnNewDocument` (script-text form,
  JSON.stringify'd values), then navigates with only `?theme=`. The SPA's existing
  hydration path does the rest. The script re-runs on every navigation, so the
  font-stall fallback reload re-seeds automatically.
- Verified: full e2e 108/108 through the LIVE site via seeding, and resume suite 5/5
  against the LOCAL nix build served on loopback (exact augustus shape).

### resume-site: local build served on the tailnet (user's option 2)

- `packages` → `.#resume-site` (x86_64-linux): offline `yarn workspace resume build`
  (vite/rolldown) with the SAME monorepo src filter + fetchYarnBerryDeps hash as
  homelab-api/ui — **refresh all THREE package.nix files together on yarn.lock changes.**
- `homelab.catalog.resume-site` (features/resume-site/catalog.nix): static file_server
  vhost `https://resume.plato-splunk.media` on augustus — tailnet scope, `dns.tailnet`
  record (aedilis emits A/AAAA → 100.95.250.77), `tls.cert.shared` (Caddy-managed via
  internal CA; chrome trusts it through `security.pki.certificateFiles` alford-root),
  tracing span, `try_files {path} /index.html` SPA fallback via `extraCaddyConfig`.
  Browsable mirror of the GH Pages deploy AND the print origin (user can hit either).
- `services.homelab.resumeSiteUrl = mkUrl "resume"` in the registry; the catalog module
  `mkDefault`s `services.homelab-api.resumeSiteUrl` to it → `RESUME_SITE_URL` in the
  sops env template (verified by eval). No dedicated port (shared caddy :443) — the
  earlier loopback 35428 design was replaced before deploy.
- `services.homelab-api.resumeSiteUrl` is a nullOr option: null keeps the code default
  (public site) — praeconinus untouched (resume group stays dark there).
- **DEPLOY ORDER: aedilis FIRST (DNS record), then augustus** — chrome on augustus must
  resolve resume.plato-splunk.media before printing works.

### Rejected / deferred

- User's option 1 (JsonPatch diffs vs defaults + content/print-settings redux split):
  unnecessary given localStorage seeding; would be a large restructure. Revisit only if
  the config ever outgrows localStorage (~5MB) or POST-body limits.
- Self-hosting Victor Mono (@fontsource) so the local build makes ZERO external calls:
  not done — the SPA still links Google Fonts, so augustus PDFs may render fallback
  faces via the font-stall abort path IF gstatic still stalls from augustus (unverified;
  test with `curl -m 10 https://fonts.gstatic.com/...`). Follow-up if print typography
  matters or the stall persists. yarn.lock change ⇒ hash dance ×3 (api/ui/resume-site).

### Verification this session

- e2e: full suite 108/108 (live site, seeding path) + resume 5/5 against the local
  nix build served on :39999 (throwaway static server; a stray `static-serve.mjs` may
  still be running there — kill it if so).
- `nix build .#resume-site` ✓; `nix flake check --no-build` ✓; augustus toplevel +
  env template + vhost extraConfig + catalogDns evals ✓; typecheck/lint/unit ✓.

---

## 2026-11-06 — Session 4 (augustus print-ready timeout ROOT-CAUSED: stalled webfont loads; fallback shipped)

### The bug

`POST /resume/print` on augustus: `page.goto(networkidle2)` succeeded but
`waitForSelector("html[data-print-ready]")` timed out (30s). **Not** a JS-disabled /
renderer problem — puppeteer enables JS by default and a baseline headless run against
the live site sets the attribute in ~1.1s.

**Root cause:** resume's `index.html` loads Victor Mono from `fonts.googleapis.com`
(CSS) + `fonts.gstatic.com` (woff2). When those requests STALL in flight (dropped
egress upstream — host firewall is inbound-only, so something further out),
`document.fonts.ready` never settles ⇒ `PrintConfigProvider` never sets
`data-print-ready` ⇒ selector timeout. And `page.pdf()` ALSO hangs while font loads
are pending (verified: 30s protocol timeout), so setting the flag earlier alone would
NOT rescue the print. If font requests fail FAST (DNS refused etc.), everything works
(failures settle fonts.ready).

Reproduced locally via `--host-resolver-rules=MAP fonts.gstatic.com 10.255.255.1`:

- gstatic-only stall ⇒ goto OK (~1.1s) + selector timeout + `document.fonts.status
  === "loading"` with 12 pending Victor Mono faces — **exact augustus symptom**
- both hosts stalled ⇒ goto(networkidle2) itself times out (stalled connections never
  let the page go idle)

### The fix (commit `9d53263b`, services-node pdf-print-service)

- `puppeteer-run`: passively tracks in-flight font-host requests (Set<HTTPRequest> via
  request/requestfinished/requestfailed — zero overhead on happy path). On print-ready
  failure: if pending font requests > 0 (or `document.fonts.status === "loading"` via
  page.evaluate), enable request interception aborting `fonts.(googleapis|gstatic).com`,
  reload once, re-await the selector. Aborted loads settle fonts.ready; PDF renders with
  the site's `display=swap` fallback faces. Error message notes "(after font-stall
  fallback reload)". Validated all three scenarios against the live site: baseline 1.6s
  no-fallback (real fonts); both stall variants ⇒ %PDF via fallback.
- `pupeteer-cleanup`: console-log drain moved BEFORE `browser.close()` (+ best-effort
  second drain after). Drain can't fail (takeAll + Effect<void>), so a failing close can
  no longer skip it. This SUPERSEDES the WIP `Effect.addFinalizer` approach: ambient
  addFinalizer leaks `Scope` into printResume's R channel (Def contract is R = never),
  and acquireUseRelease already guarantees release on use failure/interruption —
  reordering covers the only real gap (close failing before the drain).
- acquire: `browser.close()` if `newPage()` fails post-launch (release never runs when
  acquire fails — was a chrome-process leak path).
- Full validation after: e2e 14/108 green (happy path unchanged), lint 0 errors, unit
  tests green, typecheck green.

### Deploy + follow-ups (user)

1. Deploy the fix to augustus (push + `nixos-rebuild switch`). Printing will then SUCCEED
   even with the font stall — but PDFs render with **fallback fonts** until egress is
   fixed or fonts are self-hosted.
2. Diagnose augustus egress (run ON augustus):
   `curl -4 -sS -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 10 'https://fonts.googleapis.com/css2?family=Victor+Mono&display=swap'`
   and same for a gstatic woff2 URL from that CSS (plus `-6` variants — a broken IPv6
   path is a classic stall cause; also check upstream router/firewall and DNS resolver
   behavior for those hosts).
3. Optional root fix: **self-host Victor Mono** in the resume bundle (@fontsource) and
   drop the Google `<link>`s — removes the third-party failure class entirely, PDFs
   always get real fonts, better privacy. Needs a GH Pages redeploy.
4. Optional frontend hardening (independent): bound `document.fonts.ready` with a
   timeout in `provider.tsx` before setting `data-print-ready` (server-side fallback
   makes this non-critical).

---

## 2026-11-05 — Session 3b (e2e infra: standalone script, CI job, pre-commit guard, fixture bootstrap)

### Commits

| Commit     | What                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3de6691f` | e2e extraction: `scripts/e2e.sh` + `scripts/stage-e2e-secrets.mjs`, devshell command execs the script, shellcheck-gate registration, CI `E2E` job, lint-staged e2e guard, resume success-test chrome gate, AGENTS.md refresh |
| `48f0d668` | bootstrap fix: stage `private/serial-numbers.json` + `SERIAL_NUMBERS_FILE` (EAP-TLS wifi FGA test's IP→serial map)                                                                                                           |

### How e2e works now

- **`scripts/e2e.sh`** (executable, ShellCheck-linted via `flake.lintedShellScripts` →
  `checks.x86_64-linux.shellcheck`; the devshell `e2e` command just `exec`s it).
  - Args pass through to vitest as test-file filters; path args are normalized
    (anything matching `*packages/homelab-e2e-tests/<rel>` becomes `<rel>` — vitest
    filters match paths RELATIVE TO THE WORKSPACE ROOT, not absolute or
    repo-root-relative). Flags (`-*`) pass through untouched. No args = full suite.
  - Runs `node scripts/stage-e2e-secrets.mjs` first, then builds the bundle, starts
    the server on :54328 (`E2E_PORT` overrides), waits for health (30s, aborts early
    if the server PID dies, dumps a log tail on failure), runs the suite, kills the
    server via EXIT trap. Logs: `.e2e-log-dump.txt`.
  - Mirrors `CHROME_EXECUTABLE` from `.env-serve-test` into the shell when unset, so
    the test-side chrome gate matches what the server will see.
- **`scripts/stage-e2e-secrets.mjs`** — idempotently generates the machine-local
  NON-SECRET fixtures (existing files are NEVER overwritten; delete to regenerate):
  `packages/homelab-server/.env-serve-test`, `private/api-keys.json` (the three test
  keys matching e2e `testing-layer.ts`), `private/jwk.json` (fresh ES256 private key
  as a flattened PBES2-HS256+A128KW JWE — exactly what `IssuerJwkResolver` decrypts;
  jose only exports compact encryption, so the script re-maps the five compact
  parts), `private/jwk.pub.json`, `private/jwk-secret`, `private/hmac-secret`,
  `private/serial-numbers.json` (contract: `192.168.1.10` recognized, `10.0.0.99`
  NOT — `wifi.test.ts` asserts both), and delegates to `stage-test-secrets.mjs` for
  the services-node unit fixtures. `KANIDM_OPENID_PROVIDER_URL` points at the real
  IDM URL but the startup fetch degrades gracefully (`Effect.option` in
  `oidc-config-remote.ts`) — CI passes without tailnet access.
- **CI** (`.github/workflows/ci.yml` job `E2E`): plain node/yarn via the existing
  `setup` composite action — deliberately NO Nix and NO chrome. `CHROME_EXECUTABLE`
  unset ⇒ the live resume-print success test self-skips via the `describeWithChrome`
  gate in `print.test.ts`; puppeteer never launches a browser. Everything else runs
  against the real bundled server. NOTE: CI's `nix flake check --no-build` never
  BUILDS checks — the shellcheck gate only runs locally (or via
  `nix build .#checks.x86_64-linux.shellcheck`); actually running the e2e suite
  inside a nix check derivation is not viable (needs a live localhost server,
  network, machine-local fixtures), hence the separate CI job.
- **pre-commit** (`lint-staged.config.js`, `"*"` function): staged changes under
  `packages/{homelab-server,homelab-services,homelab-services-node,homelab-api,shared}/`
  or `yarn.lock` ⇒ full `e2e` (the bundle-bug guard that would have caught `mask`);
  e2e-workspace-only changes ⇒ `e2e <touched test files>`; anything else ⇒ no e2e.
  Assumes commits happen inside the devshell (`e2e`/`yarn` on PATH) — the same
  assumption the existing `fmt .` entry already makes. Agents still use `--no-verify`.

### Verification (all green)

- `nix flake check --no-build` ✓; `nix build .#checks.x86_64-linux.shellcheck` ✓ (lints e2e.sh).
- Main checkout: `e2e packages/homelab-e2e-tests/src/status` → filter normalized, 8 tests;
  full `e2e` → 14 files / 108 tests (chrome present ⇒ success test RAN).
- **Fresh-worktree CI simulation** (no node_modules, no fixtures, `CHROME_EXECUTABLE`
  unset via `env -u`, `yarn install --mode=skip-build`): bootstrap generated all
  fixtures → 107 passed + 1 skipped. This is the exact path the GitHub Actions job takes.
- `yarn typecheck` ✓, `yarn lint` ✓ (4 pre-existing resume warnings only), lint-staged
  config function outputs verified for server-side / e2e-only / docs-only staged sets.

### Gotchas

- The generated `.env-serve-test` omits options with server-side defaults (CA_URL,
  ACME_*, LOG_STYLE, CHROME_EXECUTABLE, RESUME_SITE_URL) and PORT/HOMELAB_ORIGIN_URL —
  the script exports those and dotenvx never overrides existing process env.
- `api-keys.json` / `serial-numbers.json` in the generator are the e2e contract — if
  tests grow new keys or recognized IPs, update `scripts/stage-e2e-secrets.mjs` too.
- vitest positional filters match RELATIVE-to-workspace paths — hence e2e.sh's
  normalization; pass flags as separate args.

---

## 2026-11-05 — Session 3 (`mask` FIXED, cleanup-hang FIXED, Effect.fn refactor DONE)

### Commits this session (all on `main`, NOT pushed)

| Commit     | What                                                                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d0874d86` | **`mask` crash + print hang fixed.** (a) rolldown `stubOptionalNative` now stubs `bufferutil`/`utf-8-validate` with a **throw** instead of `module.exports = undefined`; (b) pdf-print-service log capture reworked (see below)         |
| `51246774` | nix: refresh `fetchYarnBerryDeps` hash → `sha256-ybqsSNJijqPiFj45uVb92xC+pXXIVwEtuBawSQNxSb8=` in BOTH package.nix files (was stale since `8a70e6a2` changed yarn.lock — session 2's "hashes unchanged" note was WRONG)                 |
| `5a06830c` | **Effect.fn refactor complete**: all 21 accessors / 14 files in `homelab-services/src/services/*.ts` now `Effect.fn("ServiceName.method")(function*(…) { const svc = yield* Service; return yield* svc.method(…) })`; skill doc updated |

### What was actually wrong with `mask` (supersedes session-2's recommended fix)

- Session 2's recommended `WS_NO_BUFFER_UTIL` env fix **does not work**: the ws code lives in
  the `NodeWebSocketTransport-*.js` chunk, a STATIC import of `main.js` — ESM evaluates all
  static imports before the importing module's body, so any env assignment in `main.ts` runs
  AFTER the chunk's `if (!process.env.WS_NO_BUFFER_UTIL)` check. (Verified empirically.)
- Applied fix instead: the stub in `packages/homelab-server/rolldown.config.js` now does
  `throw new Error(...)`. ws requires the optional natives INSIDE try/catch
  (`require_bufferutil()` is a lazy `__commonJSMin` factory called at the require site), so
  throwing reproduces dev/tsx behavior exactly: catch → pure-JS `_mask`/`_unmask`. Order-
  independent; fixes both the chunk copy and main.js's copy of ws.
- **Second bug uncovered once launch succeeded:** every print request then HUNG (test timed
  out at 120s; `puppeteer-run` span completed OK in ~1.3s). Cause: release step did
  `Stream.runCollect(logStream)` over a `Stream.callback` — a callback stream never
  terminates. Also latent: the stream's elements were `Effect<void>` values that runCollect
  would merely COLLECT (never execute), so session 2's console-log bubbling never actually
  logged anything. Fix in `pdf-print-service.ts` (services-node): unbounded `Queue` of log
  effects created per request; `page.on("console", …)` offers directly (acquire); release
  runs `browser.close()`, then `Queue.takeAll` + `Effect.forEach` to execute the captured
  log effects, then `Queue.shutdown`.

### Verification state (all green, this machine)

- `e2e` devshell command (bundled server on :54328) with
  `CHROME_EXECUTABLE=/nix/store/bnpw53y1w97ap7yvvr6livnkswgijif0-chromium-156.0.8078.79/bin/chromium`:
  **14 files / 108 tests green**, incl. the live `%PDF` resume-print success test (~1.6s
  round trip against the live site). Run TWICE: after the mask/hang fix, and again after the
  Effect.fn refactor. `.e2e-log-dump.txt`: 0 `TypeError`s; new accessor spans confirmed in
  traces (`AuthorizationService.canCreate/canView`, `ClaimCheckService.issue`,
  `PdfPrintService.printResume`, `TokenIssuerService.issueToken`,
  `WifiProfileService.wpaPersonalWifi`, `XmlPrintingService.printXml`).
- `yarn lint` (0 errors; 4 pre-existing warnings in packages/resume), `yarn typecheck`,
  `yarn test` (600 services-node + 55 server + 11 + 10 + others) ✓
- `nix build .#homelab-api` ✓ with the refreshed hash (clean tree).

### Effect.fn refactor details (for reviewers / next agents)

- Public types preserved exactly via `Effect.fn.Return<A, E, R>` generator-return
  annotations (same A/E/R as the old `Effect.Effect<A, E, R>` signatures); `{@inheritDoc}`
  JSDoc and spread-param forms (`...params: Parameters<Def["m"]>`) kept.
- `export function foo(...)` became `export const foo = Effect.fn(...)(...)` (matching the
  established handler style). No runtime-circular-import risk: service files only
  type-import each other.
- Special cases: `feature-flag-service.enabled` (sync Def method → plain `return
  svc.enabled(...params)`, no `yield*`); `fine-grained-authorization-service.refine<E, R>`
  stays an `export function` (it returns a transformer) whose body returns the
  `Effect.fn`-built function, with `svc.refine<E, R>(...)(effect)` explicitly instantiated
  (bare `svc.refine(...)` would infer `unknown` for E/R — the old `pipe(effect, _.refine(...))`
  form got contextual inference; direct application does not).
- Out of scope (left alone): test-utils in services-node/e2e-tests still use the old
  `Service.pipe(Effect.flatMap(...))` form; they're not exported accessors.
- `.opencode/skills/effect-services/SKILL.md` accessor-pattern section updated (incl. the
  generic-Def-method note).

### What remains (ordered)

1. **User deploy**: push `main` (user's yubikey; agents never push) + `nixos-rebuild switch`
   augustus — now ALSO carries the mask/hang fix and the refreshed yarn hash, so the
   deployed bundle will actually print. praeconinus sanity check (resume group dark there)
   still pending from session 1.
2. **Manual verification checklist** (session 1, item 4 — still valid; re-run after deploy
   since the server bundle changed).
3. Optional polish (unchanged): silent token renew (`automaticSilentRenew` off), IdP-side
   logout (`signoutRedirect` + post-logout URI), browser pooling in PdfPrintService (only if
   print volume warrants; per-request launch currently adds ~1s), test-file filter for the
   `e2e` flake command (user's own TODO), `RESUME_SITE_URL` per-deployment in nix.

### Gotchas (new / refreshed)

- **Chunk evaluation order**: anything a bundled static-import chunk reads at module-eval
  time (like ws's env checks) CANNOT be influenced from `main.ts` code — fix it at the
  bundler level (stub/plugin) or via real process env (systemd unit / dotenvx).
- **`Stream.callback` never terminates** — `runCollect`/`runForEach` over it hangs. For
  capture-then-drain patterns use a `Queue` (+ `takeAll` in cleanup), or fork a consumer
  fiber and interrupt it.
- The `e2e` devshell command rebuilds the bundle each run — always exercise it after
  touching rolldown config, puppeteer/ws-adjacent code, or anything in the server graph.
- fetchYarnBerryDeps hash went stale SILENTLY in session 2 (yarn.lock changed in `8a70e6a2`
  without the fakeHash dance). After ANY commit touching yarn.lock: redo `nix-hashes` for
  BOTH package.nix files.
- Everything else from sessions 1–2 still applies: `nix develop . --command yarn …`, `git
  add` before nix eval, clean tree for the homelab-api derivation, `--no-verify` commits,
  never push, light subagent models WITHOUT variant suffixes, `.env-serve-test` +
  `.e2e-log-dump.txt` are gitignored/machine-local.

---

## 2026-11-05 — Session 2 wrap → handoff (live-verified, `mask` root-caused, new e2e workflow)

### Verified live by the user

- **OIDC login flow works end-to-end** against deployed augustus + live resume
  (kanidm `resume.printing` group/claim-map/callbacks applied by the user's deploy).
- Body double-scrollbar fix (`c3828673`) confirmed fixed by the user.

### User commits since session 1

- `12d32a54` — `packages/homelab-services-node/src/layers/pdf-print-service.ts`: refined
  the Effect implementation (`Effect.acquireUseRelease` around launch, `signal` wired into
  `puppeteer.launch`) and added **puppeteer page-console log bubbling**: page console
  events (log/info/warn/error/trace + group/count/time families) are captured via
  `Stream.callback` + `Queue.offerUnsafe`, mapped onto `Effect.log*` with
  console.group/count/time tracking (Refs), so browser-side logs land in server logs/otel.
  This is what surfaced the `mask` stack trace below.
- `8a70e6a2` — flake.nix devshell command **`e2e`** (+ `serve:test` script, missing yarn
  deps): `yarn workspace homelab-server build` (rolldown **bundle**) → starts
  `yarn workspace homelab-server serve:test` (dotenvx with the gitignored
  `packages/homelab-server/.env-serve-test`) on **port 54328**, exporting
  `PORT`/`HOMELAB_ORIGIN_URL`/`E2E_BASE_URL` → waits for `/status/health` (30 × 0.5s) →
  runs the FULL e2e suite → EXIT trap kills the server. Server logs land in
  `.e2e-log-dump.txt` at the repo root (gitignored). Flake TODO: no test-file filter yet.
  - **ENV GAP:** `.env-serve-test` contains NO `CHROME_EXECUTABLE` (and no
    `RESUME_SITE_URL` — the code default, the live site, is fine). So `e2e` only exercises
    the print success path when the caller exports `CHROME_EXECUTABLE` in their shell
    (or adds it to their local `.env-serve-test`). Current chromium on this machine:
    `nix build nixpkgs#chromium --no-link --print-out-paths` →
    `<storepath>/bin/chromium` (was `…bnpw53y1w97ap7yvvr6livnkswgijif0-chromium-156.0.8078.79`).

### The `mask` bug — ROOT-CAUSED, fix NOT yet applied

- **Symptom:** `POST /resume/print` → 500. `.e2e-log-dump.txt`:
  `TypeError: Cannot read properties of undefined (reading 'mask')`
  `at module.exports.mask (…/dist/bundle/NodeWebSocketTransport-DioQX_mY.js:123:20)`.
- **Root cause — our bundle, not puppeteer:** bundled `ws` buffer-util does
  `if (!process.env.WS_NO_BUFFER_UTIL) try { bufferUtil = require_bufferutil(); …
  module.exports.mask = (… ) => { length < 48 ? _mask(…) : bufferUtil.mask(…) } } catch {}`.
  The rolldown `stubOptionalNative` plugin (`packages/homelab-server/rolldown.config.ts`)
  stubs `bufferutil`/`utf-8-validate` as `module.exports = undefined;` — the require
  "succeeds" with `undefined`, so `bufferUtil.mask(...)` throws on CDP websocket frames
  ≥ 48 bytes (i.e. every real puppeteer↔chrome session). Same latent crash via
  `utf-8-validate` (`WS_NO_UTF_8_VALIDATE`). Bundle-only: under tsx `dev` the real
  `require` throws → catch → pure-JS fallback, which is why dev never showed it.
  (Session-1's code-splitting hypothesis was WRONG — chunk refs are self-contained.)
- **Recommended fix (small):** make ws skip the native requires entirely — set
  `process.env.WS_NO_BUFFER_UTIL = "1"` and `process.env.WS_NO_UTF_8_VALIDATE = "1"`
  before ws loads. Cleanest: new `packages/homelab-server/src/ws-native-env.ts` with
  those two `??=` assignments, imported as the FIRST import of `src/main.ts` (ESM
  evaluates imports in order). Rejected alternatives: teach the stub pure-JS
  mask/unmask (duplicates ws internals); externalize puppeteer-core + ship node_modules
  in the nix derivation (large).
- **Verify:** export CHROME_EXECUTABLE, run `e2e` → resume suite green incl. `%PDF`
  success test; grep `.e2e-log-dump.txt` for absence of the TypeError; then
  `nix build .#homelab-api` (bundle changed → derivation rebuild; hashes unchanged).

### Next steps (ordered, for the next agent)

1. Apply the `WS_NO_*` fix; run `e2e` (with `CHROME_EXECUTABLE` exported) until the
   resume suite — success test included — and then the full suite are green; commit.
2. **Effect.fn refactor (user-assigned):** convert every exported accessor function in
   `packages/homelab-services/src/services/*.ts` (~21 functions / 14 files) from
   `Service.pipe(Effect.flatMap((_) => _.method(...)))` to
   `Effect.fn("ServiceName.method")(function*(…) { const svc = yield* Service; return yield* svc.method(…) })`
   so every call carries an otel span. Keep JSDoc `{@inheritDoc}`, signatures, and
   spread-param forms (`...params: Parameters<Def["m"]>`, e.g. authorization-service's
   canView/canModify/canCreate/canDelete, authentication-service's authenticate).
   Verify: `yarn typecheck`, `yarn test` (services-node ~600, server ~55), `yarn lint`;
   update the accessor-pattern section of `.opencode/skills/effect-services/SKILL.md`.
3. Optional polish (session-1 list): silent token renew (`automaticSilentRenew` off),
   IdP-side logout, browser pooling in PdfPrintService, test-file filter for the `e2e`
   flake command (user's own TODO).

### Gotchas (new / refreshed)

- `e2e` (devshell) is now the sanctioned e2e path — builds the BUNDLE, so it catches
  bundle-only bugs like `mask`. Don't hand-roll servers unless debugging; if you do,
  track PIDs and re-check ports afterwards (session-1 recipe below still valid).
- `.env-serve-test` + `.e2e-log-dump.txt` are gitignored, machine-local.
- When something works under `dev` (tsx) but fails under `serve`/deployed: suspect the
  rolldown bundle (stubOptionalNative stubs, CJS interop, chunks) and read the stack
  frames in `.e2e-log-dump.txt` (`dist/bundle/…`).
- All session-1 gotchas still apply: nix fakeHash dance on yarn.lock changes, `git add`
  before nix eval, clean tree required by the homelab-api derivation, `--no-verify`
  commits, never push, light subagent models WITHOUT variant suffixes.

---

## 2026-11-03 — Session 1 (planning + Phases 1–8 implemented; deployment pending)

### Commits this session (all on `main`, NOT pushed)

| Commit                                | What                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `0a30f89`                             | rename `homelab-shared` → `shared` (browser-safe: dropped unused node deps)             |
| `f1a298c`                             | extract print-config schemas + base64 codecs → `shared/src/print-config/` (+11 tests)   |
| `2cf271e`                             | `shared/oidc` subpath: oidc-client-ts wrapped in Effect (AuthService, checkReachable)   |
| `7b080e6`                             | POST /resume/print: API def + PdfPrintService (puppeteer-core) + handler + 5 unit tests |
| `6169dc`                              | resume: reachability + OIDC login + `importPrintSettings`/`theme` params + print-ready  |
| `ea839c8`                             | resume: download FAB (typed HttpApiClient → blob download)                              |
| `3539d54`                             | resume: Chakra toaster (FAB feedback + homelab error bridge)                            |
| `98d7e6a`                             | nix: kanidm resume.printing group/claim-map/callbacks, CHROME_EXECUTABLE, hash refresh  |
| `ddb9aee`                             | e2e: resume/print tests, Resume_Print on test API key, enum + hash refresh              |
| (uncommitted → commit at session end) | skill docs v4 refresh, plan/progress updates, `application/pdf` content-type            |

Plus: `repos/puppeteer` subtree added at tag `puppeteer-core-v25.16.0` (merge `415d44d`),
registered in AGENTS.md + effect-services skill tables.

### Validation state (all green at session end)

- `yarn lint` ✓, `yarn typecheck` ✓, `yarn test` ✓ (676 tests: shared 11, services-node
  600, server 55, + others)
- `nix build .#homelab-api` ✓ (fetchYarnBerryDeps hash:
  `sha256-frMthV2h9fUDKk2u9XRZrMX0oZooZ07FYFQSZajMk0w=` in BOTH
  `nix-config/modules/features/homelab-api/package.nix` and `homelab-ui/package.nix`)
- `nix eval` augustus + praeconinus toplevels ✓; shellcheck gate ✓
- `yarn workspace resume build` ✓ (vite bundles homelab-api + oidc-client-ts fine)
- e2e tests written but NOT run (user runs them in watch mode — see below)

### Key architecture facts discovered (authoritative — re-verify if stale)

- **Auth for resume → homelab-server**: kanidm id_token as `Authorization: Bearer`.
  `AuthenticationService` skips DPoP for remote (kanidm) issuers; server `jwtVerify`
  requires `aud: "homelab"` + `email` + `roles` claims — those live on the **id_token**
  (that's why homelab-frontend also sends id_token). DPoP is only for the API-key
  `/oauth/token` automation path (e2e tests use it).
- **Roles → permissions**: kanidm `claimMaps.roles.valuesByGroup` (per OIDC client) →
  `roles` claim → `OIDCIdentity` permission HashSet → `AuthorizationService` checks
  `hasPermission(resource) || hasPermission(resource.operation)`.
- **CORS**: `HttpRouter.cors()` (api.ts) with no options = `access-control-allow-origin: *`
  with reflected request headers. resume.rae-hill.dev calls already work — no change was
  needed. (Tightening = env-driven allowedOrigins; deliberately skipped to not break
  unknown consumers.)
- **Systemd hardening**: `RestrictAddressFamilies = [ ]` serializes empty → systemd resets
  to allow-all (that's why the server can bind sockets today). Chrome runs with
  `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu` under the
  existing unit hardening; no unit relaxation was needed. Watch
  `ProtectProc=invisible`/`ProcSubset=pid` if the zygote misbehaves in practice.
- **Effect v4 gotchas** (bit me; skills now updated): `HttpApiEndpoint.post(name, path,
  { payload, query, success, error, headers })` from `effect/http-api`; `Context.Service<Self,
  Def>()(id)`; `Effect.gen({ self: this }, …)`; `Effect.catch` (NOT `catchAll`);
  `Option.fromNullishOr` (NOT `fromNullable`); `Duration.Input` for durations;
  `Schema.check(Schema.makeFilter(...))` for refinements; `asUint8Array({ contentType })`
  supported; query params land in `args.query`; client calls:
  `client.resume.print({ payload, query, headers })`; DPoP `htu` excludes query strings
  (matches wifi-download e2e precedent).
- **Immer + RTK**: drafts need mutable arrays — homelab slice keeps `roles: string[]`
  internally (castDraft for payload assignment); interface stays ReadonlyArray for
  consumers.
- resume is **CSR-only vite SPA on GitHub Pages** (`public/CNAME` = resume.rae-hill.dev;
  workflows copy dist/index.html → 404.html). Route tree is generated — after adding route
  files run `yarn workspace resume build` (or dev) once and commit `routeTree.gen.ts`.
- TanStack root search params must be whitelisted in `__root.tsx validateSearch` or the
  router strips them.
- Provider effect order: PrintConfigProvider (localStorage hydrate → importPrintSettings
  apply → fonts.ready → `html[data-print-ready]`) runs BEFORE RootComponent's parent
  effect that strips `importPrintSettings` via router navigate. Don't reorder.

### Env/config surface added

- Server: `CHROME_EXECUTABLE` (optional; nix option `services.homelab-api.chromeExecutable`,
  set on augustus to `${pkgs.google-chrome}/bin/google-chrome-stable`), `RESUME_SITE_URL`
  (optional, default `https://resume.rae-hill.dev` — point at `http://localhost:5173` for
  local e2e). Both also in BOTH test-utils testing layers.
- resume (vite, build-time, public): `VITE_HOMELAB_API_URL`,
  `VITE_OIDC_AUTHORITY` (kanidm client-scoped discovery base:
  `https://idm.plato-splunk.media/oauth2/openid/homelab`), `VITE_OIDC_CLIENT_ID` —
  committed `.env.production` + `.env.development`. `homelabEnv.enabled` gates everything;
  unset env = integration stays dark (no crash).
- kanidm (oidc.nix): callbacks `https://resume.rae-hill.dev/oauth-callback` +
  `http://localhost:5173/oauth-callback`; scopeMap + claimMap for group `resume.printing`
  → role `Resume_Print`; group provisioned in features/kanidm/service.nix with jacob + rae
  as members.
- e2e: `Resume_Print` added to `test-api-key-1` in `packages/homelab-server/private/api-keys.json`
  and to the nix apiKeys permissions enum.

### What remains (ordered)

1. **Commit the working tree** (skill/doc updates + `application/pdf` contentType tweak —
   re-run `yarn lint`/`yarn typecheck` first; the contentType change is in
   `packages/homelab-api/src/homelab/resume/print.ts`).
2. **User-driven deploy**: resume GH Pages rollout ✅ DONE 2026-11-04 (live at
   https://resume.rae-hill.dev with print-ready signal + import param). Still pending:
   `nixos-rebuild switch` augustus (kanidm provisioning applies resume.printing group +
   claim map + callbacks; homelab-api gets CHROME_EXECUTABLE), which needs a push first
   (user's yubikey; agents never push).
3. **e2e run (USER runs watch mode — agents must not start the server)**: dev server needs
   in `.env-local`: `CHROME_EXECUTABLE=$(which google-chrome || which chromium)` and
   `RESUME_SITE_URL=http://localhost:5173` (+ `yarn workspace resume dev` running, or use
   the deployed site once live). Success test needs chrome on the machine; asserts `%PDF`.
   **VERIFIED 2026-11-04:** full suite green (14 files / 108 tests) against a throwaway
   backend on :3100 (env-prefixed `yarn exec tsx --env-file=.env-local src/main.ts`, NO
   `--watch` so it's one killable PID) with
   `CHROME_EXECUTABLE=/nix/store/bnpw53y1w97ap7yvvr6livnkswgijif0-chromium-156.0.8078.79/bin/chromium`
   (`nix build nixpkgs#chromium`; the machine has no chrome on PATH) and
   `RESUME_SITE_URL=https://resume.rae-hill.dev` (LIVE site — user deployed it; bundle
   confirmed to contain `data-print-ready` + `importPrintSettings`). The success test
   rendered a real `%PDF` through the live site in ~4.6s. `E2E_BASE_URL` env override on
   `BASE_URL` (test-utils/api-client.ts) enables running against an alternate port
   without disturbing the :3000 dev server. NOTE: `yarn workspace <ws> exec` runs from
   the repo ROOT — cd into `packages/homelab-server` first or `--env-file=.env-local`
   won't resolve.
4. **Manual verification checklist** (user, on tailnet):
   - resume.rae-hill.dev shows Sign in (header) after the reachability probe
   - login → kanidm → /oauth-callback → back home signed in (email shown)
   - purple download FAB appears above the settings FAB for `resume.printing` members
   - click → spinner → PDF downloads; dark mode prints dark when the site is in dark mode
   - off-tailnet: no login button, no FAB, no console noise beyond the failed probe
5. **Optional polish** (not blocking): silent token renew (oidc-client-ts
   `automaticSilentRenew` is off; sessions expire with the id_token), IdP-side logout
   (`signoutRedirect` — needs post-logout URI registered), browser pooling in
   PdfPrintService if print volume ever warrants, `RESUME_SITE_URL` per-deployment in nix
   (currently the code default), praeconinus sanity (resume group dark there: feature
   flags omit Resume_Print → 404/403 via FeatureFlagService — verify gracefully).

### Gotchas for the next agent

- **Double-scrollbar / scroll-past-footer regression (fixed 2026-11-04):** the theme set
  `overflowX: hidden` on both `html` and `body`; since a hidden axis computes the other
  axis to `auto`, body became a second scroll container and — with the toaster mounted —
  gained its own scrollbar on narrower viewports, letting the page scroll past the footer
  (user-observed, headless chromium with overlay scrollbars did NOT reproduce it). Fix:
  `body { @media screen: overflow: hidden }` in `src/theme/theme.ts` globalCss, so only
  the root element scrolls (verified: root scrolls, footer lands at viewport bottom,
  body scroll range 0, print untouched). Do not "fix" this by making html/body both
  scrollable again.

- Run node/yarn ONLY via `nix develop . --command yarn …` (no node/yarn on PATH).
  `yarn workspaces foreach -At run lint` per-workspace fails (eslint not in PATH);
  use root `yarn lint` (`-Apt`).
- `git add` new files before ANY `nix eval`/`nix build` (flake reads the git tree;
  homelab-api derivation even requires a CLEAN tree — commit before eval).
- yarn.lock changes ⇒ redo the `nix-hashes` dance for BOTH package.nix files (fakeHash →
  `nix build .#homelab-api` → paste `got:` hash). Happens on ANY dependency add.
- The harness auto-formats files after write/edit — if an edit tool call fails to match,
  re-read the file first.
- `Effect.runPromise` boundaries in resume live in `state/homelab/{runtime,print}.ts` and
  hooks — keep effectful code as Effects; dispatch at the boundary only.
- Test scoping trap: `@effect/vitest` `it.effect(name, () => Effect…)` — variables used in
  the `.pipe(Effect.provide(...))` section must be declared OUTSIDE the generator.
- Commits: `git commit --no-verify`; NEVER push (user's yubikey).
- Subagents: use lighter models (e.g. `qwencloud-token-plan-personal/qwen3.8-flash` —
  NO variant suffix, it errors) for exploration; they work well.
- The FIRST exploration subagent (`ses_e5d7dd9f8ffevi9Hz1AH7ic5lC`) never reported; a
  duplicate on the flash model (`ses_e5bff9f59ffeX3IVhXEs9qtdPt`) delivered the findings
  summarized in plan.md Phase 1c/2d. Neither is needed anymore.
