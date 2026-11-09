# OpenClaw on mini — Progress & Handoff Log

Living document. Plan: [./openclaw-mini-plan.md](./openclaw-mini-plan.md).
Newest entries first. Agents: append, don't rewrite history.

---

## 2026-11-09 — Session 4: mTLS enabled on the openclaw vhost; secrets staged by jacob

- **jacob filled in all five sops secrets** in `secrets/mini.yaml` (his confirmation; contents
  never seen by agents — by design).
- **mTLS on `openclaw.plato-splunk.media`** (jacob: "lock agents down with mTLS"; iPad + iPhone
  hold client certs): `features/openclaw/catalog.nix` now sets `tls.gate.mtls.trustPoolFile =
  config.constants.ca.rootCert` + `tls.cert.shared = {}` — identical gate to mini's metrics
  vhosts. Rendered fragment verified via eval:
  `tls { client_auth { mode require_and_verify; trust_pool file { pem_file <store>/certs/alford-root.crt } } }`
  - `reverse_proxy 127.0.0.1:18789`, server cert via Caddy-native ACME (global `acme_ca` →
    step-ca). Gateway **token auth stays on behind mTLS** (cert = device factor, token = operator
    factor). Devices without a client cert now fail the TLS handshake — intended.
- ⚠ **Gotcha recorded:** `config.constants.*` lives in the FLAKE-PARTS config — `rootCert` must
  be bound in the file-level module let (outer `{ config, ... }:`), NOT inside the
  `flake.modules.darwin.*` module body whose `config` is the darwin system config (eval error
  "attribute 'constants' missing"). Same structure as `mini-jellyfin/catalog.nix`.
- Mini toplevel eval ✓ after the change. Deploy order unchanged: **aedilis first** (DNS before
  HTTP-01), then mini. Post-deploy browser flow: client-cert handshake → paste gateway token →
  one-time device pairing approval on mini.
- Also this session (earlier): `doSTARTTLS: true` hardening in proton-mail-mcp (commit
  `dfcee921b2b8`) — STARTTLS now REQUIRED, never cleartext fallback.

---

## 2026-11-09 — Session 3: labeling enabled, PHASE 3 vhost + DNS implemented, main-checkout yarn verified

### Changes (all validated via eval; committed this session)

- **Labeling ENABLED** (`features/openclaw/service.nix` → `mcp.servers.protonmail.env`):
  `PROTON_MCP_OPERATIONS: "read,label"`, `PROTON_MCP_ALLOWED_LABELS: "Declined,Applied,Needs
  Follow-Up,Job Hunt"` (jacob's exact label names — case-sensitive match against Proton labels;
  spaces fine, CSV splits on commas only; `mail_list_labels` will show which exist on the account,
  `mail_add_label` creates missing label folders via IMAP CREATE).
- **Phase 3 vhost**: new `features/openclaw/catalog.nix` (`flake.modules.darwin.openclaw-catalog`,
  imported from complete.nix) → `homelab.catalog.openclaw`: subdomain `openclaw`, host mini,
  `backend.reverseProxy.port = 18789`, `tls.cert.shared` (Caddy-native ACME via step-ca; NO mTLS —
  tailnet-only name + gateway token auth), `dns.tailnet`, managedBy caddy+dns.
- **Technitium provisioning**: `service-registry.nix` catalogDns += `openclaw = mkCatalogDns
  "openclaw" "openclaw" "mini";` → verified in aedilis eval: A `100.111.29.21` + AAAA
  `fd7a:115c:a1e0::db01:1d31` for `openclaw.plato-splunk.media` in
  `services.technitium-server-complete.provision.ensureDnsRecords.zones`.
- **Mini Caddy fragment verified**: `catalog-sites.caddy` renders
  `https://openclaw.plato-splunk.media { reverse_proxy 127.0.0.1:18789 }`.
- **Gateway config hardened for the reverse proxy** (research subagent
  `ses_e3ea3dbd3ffeaf228UvW5yrZm1`, docs verified at tag v2026.10.5):
  - `gateway.trustedProxies: ["127.0.0.1"]` — WITHOUT this, same-host proxied traffic gets
    HTTP 403 `proxy_attribution_required` / WS auth failure (docs: rate-limiting.md "Unconfigured
    same-host reverse proxies"). The #1 would-be failure.
  - `gateway.publicOrigin: "https://openclaw.plato-splunk.media"` — feeds `controlUi.allowedOrigins`;
    custom domains are NOT auto-accepted (only loopback/RFC1918/link-local/.local/.ts.net/CGNAT),
    so browser origin checks would reject the vhost without it. Do NOT use `["*"]` or
    `dangerouslyAllowHostHeaderOriginFallback`.
  - Kept `auth.mode: "token"` — `trusted-proxy` mode is for identity-aware proxies only (docs
    "When NOT to use": plain TLS terminators). Kept `bind: "loopback"` (correct when proxied).
  - Caddy side needs nothing extra (WS Upgrade + XFF rebuild automatic). HSTS could be added at
    the vhost later (single TLS termination point) — skipped for now.
- **yarn/hashes in main checkout** (`~/git/homelab`): `yarn install` (devshell) → link-step only,
  tree clean afterward; `update-missing-hashes` → no change. FOD hash
  `sha256-qVDumxrjcdoORTq1Q0HooA0levjmDwsMsacZOeFokjk=` (session 2) still current. Nothing to update.
- **STARTTLS hardening** (jacob question → verified vs imapflow 2.x types.d.ts): `doSTARTTLS:
  true` now REQUIRED for starttls mode — without it ImapFlow is opportunistic and would continue
  CLEARTEXT with only a warning if STARTTLS were stripped. Bridge default mode = STARTTLS
  (127.0.0.1:1143, self-signed cert; `PROTON_BRIDGE_TLS_MODE=implicit` if the Bridge "Connection
  mode" toggle is switched to SSL). Trust: `rejectUnauthorized: false` ONLY for loopback hosts
  (Env refuses non-loopback without `PROTON_BRIDGE_TLS_CA_FILE` pinning the Bridge cert).
- Plan doc: phase-3 step 10 checked; tool-name drift fixed (`mail_set_read`/`mail_set_starred`,
  - `mail_list_labels`); label decision recorded. port-assignments note updated (vhost active).

### jacob: deploy notes (updated)

- **Deploy ORDER matters now: aedilis FIRST** (`remote-build-aedilis` devshell command) so
  Technitium serves `openclaw.plato-splunk.media` → mini's tailnet IP **before** mini's Caddy
  requests the step-ca cert (HTTP-01: CA resolves the name and hits mini's auto-`:80` challenge
  listener — same mechanism jellyfin already uses). Then mini: `darwin-rebuild switch --flake
  ~/git/homelab#mini`.
- First proxied browser visit to `https://openclaw.plato-splunk.media`: paste the gateway token
  ("Gateway secret") + **one-time device pairing approval on mini** (loopback auto-approve does
  NOT apply through a proxy — docs: connect-and-pair.md). Then `openclaw security audit`.
- Treat the vhost as admin-grade exposure: `/v1/*` bearer = full operator access (tailnet-only
  DNS + token auth are the boundary).
- Strict-schema reminder: `publicOrigin`/`trustedProxies` key names verified against v2026.10.5
  docs, but run `openclaw config validate` on mini post-deploy (exit 78 = unknown key).

---

## 2026-11-09 — Version decision: openclaw stays on nixpkgs 2026.10.5 (jacob, confirmed)

- Upstream is ahead: **v2026.11.2** latest stable tag (v2026.11.5-beta.1 published; also
  v2026.10.10, v2026.11.1 since ours) — checked via `git ls-remote` tags.
- BUT current `nixos-unstable` HEAD **still packages 2026.10.5** (verified against
  raw.githubusercontent package.nix) — a `nix flake update nixpkgs-unstable` today gains nothing.
  Our locked unstable (rev `31ecbaca`) also has 2026.10.5.
- Derivation takes `version ? "2026.10.5"` but hardcodes `src.hash` + `pnpmDepsHash` for that tag
  ⇒ riding v2026.11.2 now would need `overrideAttrs` with self-computed hashes (multi-GB pnpm FOD,
  manual hash upkeep per bump, drift from nixpkgs-maintained packaging + our vendored corroboration).
- **DECISION: deploy 2026.10.5** (matches our v2026.10.3–10.5 config-schema research — best-validated
  pairing). Bump later via one-liner `nix flake update nixpkgs-unstable` once nixpkgs's updateScript
  lands 2026.11.x (typically days). If bumped: re-run `openclaw config validate` on mini (strict
  schema, exit 78 on drift) and re-verify `mcp.servers`/gateway keys against the new bundled docs.
- `allowInsecurePredicate` keys on pname (not name-version), so version bumps won't break mini's eval.

---

## 2026-11-09 — Session 2: merged main → worktree, fast-forwarded main (merge commit `ea2368ad46a2`)

- main had advanced **38 commits** since branch point `f733fbeba7a6` (resume-tailor feature,
  new `homelab-services-browser` workspace, OpenRouter fixes, e2e/test-fixture tooling, AGENTS.md
  e2e guidance update).
- **Conflicts (only 3 files, all resolved mechanically):** `homelab-api/package.nix` +
  `homelab-ui/package.nix` (both sides refreshed the shared `fetchYarnBerryDeps` hash — main for
  the new workspace, this branch for imapflow/postal-mime) and `yarn.lock` (auto-merged cleanly;
  revalidated with `yarn install` — link-step only, no drift).
- **Resolution:** merged lockfile → single recomputed shared FOD hash
  **`sha256-qVDumxrjcdoORTq1Q0HooA0levjmDwsMsacZOeFokjk=`** set in homelab-api, homelab-ui, AND
  openclaw/mail-mcp-package.nix. `missing-hashes.json` unchanged.
- **Validation after merge:** root typecheck ✓ · root lint ✓ (0 errors) · ALL unit tests ✓
  (733 homelab-services-node + 18 proton-mail-mcp + rest) · `nix build .#homelab-api` ✓ ·
  shellcheck gate ✓ · mini toplevel eval ✓ · aarch64-darwin proton-mail-mcp eval ✓.
- ⚠ **Fresh-worktree gotcha (from main's new tooling):** unit tests in homelab-services-node need
  machine-local fixtures — run `node scripts/stage-test-secrets.mjs` once per checkout (stages
  gitignored `private/hmac-secret` + `private/jwk.json`; 627 tests fail without it). e2e uses
  `scripts/stage-e2e-secrets.mjs` via the devshell `e2e` command.
- main fast-forwarded to the merge result; worktree HEAD == main.
- Deploy checklist for phases 1+2 unchanged (part 4 below); jacob to add the FIVE sops keys +
  install Proton Bridge on mini.

---

## 2026-11-05 — Session 1 (part 4): PHASE 2 IMPLEMENTED — packages/proton-mail-mcp — committed `4d5be4757`

### What landed

- **`packages/proton-mail-mcp`** — first-party MCP stdio server on **Effect 4.1.2 core MCP**
  (`effect/ai/McpServer.layerStdio`, no external MCP SDK), ImapFlow 2.10 + postal-mime 4.2 over
  Proton Bridge IMAP. Layout: `src/{env,schemas,errors,server,main}.ts`,
  `src/services/{mail,policy}.ts` (defs), `src/layers/imap-mail.ts` (impl),
  `src/tools/{failure,read,label}.ts`; assembly is a `makeRegistrations(mail, policy)` factory
  (shared by main + tests).
- **Tools** — read (5): `mail_list_folders`, `mail_list_messages` (seq-range paging, newest
  first, pageSize clamped), `mail_get_message` (postal-mime parse, body truncation via
  PROTON_MCP_MAX_BODY_BYTES, attachment METADATA only — never content-to-disk),
  `mail_search_messages` (subject/text/from/since/unseen → IMAP SEARCH), `mail_get_unread_count`
  (STATUS). Label (5, gated): `mail_list_labels` (whitelist ∩ server), `mail_add_label` (COPY
  into `Labels/<x>`, creates folder if missing), `mail_remove_label` (conservative: resolve home
  folder via `X-Pm-Gluon-Id` header SEARCH across non-Labels/non-"All Mail" folders; REFUSES on
  0 or ≥2 matches), `mail_set_read`, `mail_set_starred`. **No send/delete/trash/move tools exist.**
- **Policy enforcement (4 layers):** (1) `McpServer.visibility` gates hide whole toolkits unless
  operation enabled (hidden = absent from listTools + calls fail not-found); (2) handler-level
  whitelist checks → `policy_denied`; (3) service-level `assertLabelAllowed` re-validation;
  (4) OpenClaw `toolFilter: {include: ["mail_*"]}` client-side.
- **Env surface:** `PROTON_BRIDGE_IMAP_HOST` (default 127.0.0.1), `_PORT` (1143), `_USERNAME`,
  `_PASSWORD`, `_TLS_MODE` (starttls|implicit), `_TLS_CA_FILE`; `PROTON_MCP_OPERATIONS` (default
  `read`; opt-in `label`), `PROTON_MCP_ALLOWED_LABELS` (required non-empty with `label`; rejects
  `/ \ NUL`), `PROTON_MCP_MAX_BODY_BYTES` (20k), `PROTON_MCP_MAX_LIST_MESSAGES` (25, cap 100).
  Validation in pure `buildEnv()` (unit-tested); TLS trust relaxed ONLY for loopback hosts,
  non-loopback requires CA pin.
- **Errors:** `MailToolFailure` schema kind ∈ bridge_unavailable | imap_error | message_not_found
  | policy_denied | mail_parse_error; ECONNREFUSED-class → bridge_unavailable ("is Bridge
  running and unlocked?"); AuthenticationFailure → creds hint.
- **Nix:** `features/openclaw/mail-mcp-package.nix` → `flake.packages.aarch64-darwin.proton-mail-mcp`
  (homelab-api pattern: nix-filter → fetchYarnBerryDeps → `yarn workspace proton-mail-mcp build`
  → nodejs_26 wrapper). New shared FOD hash **`sha256-5jb0LaHA0c+Icd7tmwt6/yKzU49N2MTeUQTuYnntVaA=`**
  set in homelab-api/homelab-ui/proton-mail-mcp package.nix (yarn.lock changed: imapflow,
  postal-mime). `missing-hashes.json` regenerated (no content change).
- **openclaw service.nix:** `mcp.servers.protonmail` wired (command = flake package, env =
  `${PROTON_*}` substitution, `PROTON_MCP_OPERATIONS: "read"` **read-only default**, toolFilter);
  sops secrets += `proton_bridge_username`, `proton_bridge_password` (wrapper exports; wait-loop
  covers all 5).

### Verification (all on linux; darwin build deferred to mini)

- `yarn workspace proton-mail-mcp typecheck` ✓ · `test` ✓ **18/18** (env validation, visibility
  policy per env, tool roundtrips vs stub service, pageSize clamp, policy_denied w/o service
  touch) · `build` (rolldown) ✓ 3.5 MB bundle.
- **End-to-end stdio smoke test of the BUILT bundle**: piped real MCP handshake → negotiated
  protocol 2025-11-25, serverInfo/instructions, `tools/list` showed exactly the 5 read tools
  (default read-only policy) with JSON Schemas. ✓
- Root `yarn lint` ✓ (0 errors, 4 pre-existing resume warnings) · root `yarn typecheck` ✓ ·
  `nix build .#homelab-api` ✓ (validates new FOD hash + lockfile) · `nix eval` darwin package
  drvPath ✓ · mini toplevel drvPath ✓ · rendered config protonmail entry ✓ (literal `${PROTON_*}`).

### Effect v4.1.2 McpServer API lessons (for future agents — none of these are in stable docs)

- Imports: `effect/ai/McpServer|Tool|Toolkit|McpProtocol|McpTest` (root `effect` barrel does NOT
  re-export ai); `NodeStdio`/`NodeRuntime` from `@effect/platform-node`; stdio needs
  `Layer.provide(NodeStdio.layer)`.
- Tool `dependencies: [Tag]` declares REQUEST-level services; handlers may `yield*` exactly those;
  discharge with `McpServer.middleware<{provides: ...}>()((effect) => Effect.provideService(...))`
  — plain layers do NOT satisfy them. Pattern: closure built service instances into
  `makeRegistrations(mail, policy)` + provideService middleware.
- Assembly per toolkit: `McpServer.toolkit(kit).pipe(Layer.provide(gate.combine(services).layer),
  Layer.provide(kit.toLayer(handlersRecord)))`; `kit.toLayer` output IS the handlers layer (don't
  double-wrap). Multiple toolkits → `Layer.mergeAll`.
- `McpServer.visibility(() => Effect<boolean>)` → `.layer`; false hides from listTools AND fails
  calls not-found. Perfect for env-policy gating with static toolkits.
- v4 gotchas: no `Either` in root barrel (use `Result` + `Effect.result`, `.failure` extraction);
  `Schema.Literals([...])` for multi-value literals (Schema.Literal takes ONE arg); no `.asVoid`
  property (use `.pipe(Effect.asVoid)`); `exactOptionalPropertyTypes` + `Schema.optionalKey` ⇒
  strip undefined keys (our `compact()` helper in schemas.ts); params schemas must be Struct-rooted;
  `McpTest.makeClient(registrations, {protocols})` = in-memory client (`.listTools()`,
  `.callTool({name, arguments})` → `{content:[{type:"text",text:JSON}], isError?}`; declared
  failures return isError results, visibility-hidden calls FAIL the effect).

### Bridge/ImapFlow research (subagent `ses_e52624c0cffehoCb7XrgdxRcS2`) — design inputs

- Bridge: 127.0.0.1:1143 IMAP (SMTP 1025), STARTTLS default (GUI toggle for implicit SSL),
  self-signed cert; creds = GUI "Mailbox details" password (revocable, ≠ account password).
  **macOS: GUI app required, no headless mode**; "Open on startup" default. Bridge down/locked ⇒
  IMAP server down (ECONNREFUSED).
- Labels = `Labels/<name>` folders, virtual multi-membership; PERMANENTFLAGS only
  `\Answered \Deleted \Flagged \Seen` (**no KEYWORDS**); apply label = COPY (idempotent);
  remove = MOVE-out to home folder. gluon engine: IMAP4rev1 IDLE MOVE UIDPLUS UNSELECT, **no
  CONDSTORE/QRESYNC/SORT**; SEARCH SUBJECT/TEXT/SINCE server-side on local cache; injects stable
  `X-Pm-Gluon-Id` header (our home-folder resolution key).
- ImapFlow **2.x API ≠ 1.x docs**: `getMailboxLock` → `{path, release()}` (NO `.mailbox` —
  counters via `client.status(path, {messages|unseen: true})`); `search()` → `number[] | false`;
  use `fetchAll` (never commands inside fetch iterator); postal-mime preferred (mailparser =
  maintenance mode). Both postalsys (Nodemailer author), MIT.

### jacob: UPDATED deploy checklist (phases 1+2 together)

1. sops — `sops nix-config/secrets/mini.yaml`, add FIVE keys (switch fails if any missing):
   `openclaw_gateway_token` (e.g. `openssl rand -hex 32`), `openrouter_api_key` (sk-or-…),
   `kagi_api_key` (kagi.com/api/keys, API credits enabled), `proton_bridge_username` (Proton
   address), `proton_bridge_password` (Bridge GUI → Mailbox details → after step 2).
2. Install **Proton Mail Bridge** on mini (paid plan), log in, enable "Open on startup"; copy the
   mailbox password into sops. Note connection mode (STARTTLS default ⇒ no extra config).
3. Deploy on mini: `darwin-rebuild switch --flake <repo>#mini` — first build compiles openclaw
   from source (no binary cache: insecure-marked, tens of minutes) + proton-mail-mcp (fast).
   ⚠ If proton-mail-mcp's fetchYarnBerryDeps reports a hash mismatch ON DARWIN, refresh per
   nix-hashes skill (expected to match the linux hash — shared lockfile, platform-neutral cache).
4. Smoke: `openclaw gateway status` · `openclaw config validate` · Control UI
   `http://127.0.0.1:18789/` (token) · ask it to search mail (`mail_search_messages`) and run a
   Kagi search · `tail ~/Library/Logs/openclaw/gateway.log` (MCP stderr shows as
   `bundle-mcp:protonmail:`).
5. **Enable labeling when ready:** edit `features/openclaw/service.nix` config →
   `PROTON_MCP_OPERATIONS: "read,label"` + `PROTON_MCP_ALLOWED_LABELS: "<exact label names,
   comma-separated>"` → redeploy. (Tell me the label list and I'll wire it.)
6. Append results/gotchas here.

### Remaining work

- Phase 2 step 9: Bridge install + end-to-end triage test through OpenClaw (jacob, on mini).
- Phase 3: `openclaw.plato-splunk.media` — `features/openclaw/catalog.nix` vhost + `catalogDns`
  entry in service-registry.nix (Technitium provisioning flows via aedilis automatically).
- OpenClaw bundled-docs verification on mini (2026.10.5 vs 2026.10.3 research: run
  `openclaw config validate`; adjust keys if drift).
- Optional later: IDLE/pooled connections, attachment download (path-scoped), trash/archive ops
  (env-gated), removeLabel multi-match heuristics.

---

## 2026-11-05 — Session 1 (part 3): PHASE 1 IMPLEMENTED (nix side) — committed `9c80ee28b`

Commits: `de93c1ced` (plan+log docs), `9c80ee28b` (phase 1: mini.nix pkgs-unstable wiring +
`features/openclaw/{complete,service}.nix` + port doc). Worktree is detached-HEAD (opencode
convention — same as the other worktrees).

### What landed

- `hosts/mini.nix`: `pkgs-unstable` specialArg (aarch64-darwin, allowUnfree +
  **`allowInsecurePredicate = x: getName x == "openclaw"`** — nixpkgs marks openclaw insecure via
  `knownVulnerabilities`; predicate keys on pname so version bumps don't break eval;
  `permittedInsecurePackages` would need exact name-version). Module list += `darwin.openclaw`.
- `features/openclaw/service.nix` (`flake.modules.darwin.openclaw-service`):
  - `environment.etc."openclaw/openclaw.json"` — JSON5 skeleton: `gateway {mode local, port
    18789, bind loopback, auth token, reload off}`, `logging.file` → `~/Library/Logs/openclaw/
    gateway.log`, `agents.defaults.model.primary: "openrouter/auto"`, `mcp.servers.kagi`
    (streamable-http, `Bearer ''${KAGI_API_KEY}` header — literal `${}` via `''${` escape,
    toolFilter include kagi_search_fetch/kagi_extract). Secrets NEVER in config text.
  - Wrapper (`writeShellScript`): waits ≤120s for the 3 sops secret files (boot race with
    `sops-install-secrets` daemon), copies /etc render → **real file** `~/.openclaw/openclaw.json`
    (openclaw avoids symlinked config layouts even read-only), broadens PATH (plist `path=[coreutils]`
    alone is too narrow), exports `OPENCLAW_CONFIG_PATH`, **`OPENCLAW_NIX_MODE=1`** (immutable
    config + NIX_PROFILES PATH discovery), `OPENCLAW_SERVICE_REPAIR_POLICY=external`,
    `OPENCLAW_GATEWAY_TOKEN`/`OPENROUTER_API_KEY`/`KAGI_API_KEY` from `/run/secrets`, execs
    `openclaw gateway run`.
  - `sops.secrets.{openclaw_gateway_token,openrouter_api_key,kagi_api_key}` owner jacob, group
    staff, mode 0400.
  - `system.defaults.loginwindow.autoLoginUser = "jacob"` (FileVault caveat — plan D2).
  - `system.activationScripts.openclawLogDir` pre-creates the log dir (launchd opens
    StandardOutPath before the wrapper's mkdir can run).
  - `launchd.user.agents.openclaw`: KeepAlive + RunAtLoad, logs → `~/Library/Logs/openclaw/
    gateway.{out,err}.log`. Label `org.nixos.openclaw`.
- `docs/port-assignments.md`: Mini 18789 row + date bump.

### Schema research (subagent `ses_e52709038ffeCX6s4gciFA8OCf`, docs tag v2026.10.3)

Verified facts used above: strict schema (unknown keys → exit 78); `${UPPER_VAR}` substitution in
ANY string value incl. mcp headers/provider apiKey (uppercase regex, `$${}` escape, missing var =
warn+visible); `$include` confined to config dir; gateway.bind enum auto|loopback|lan|tailnet|
custom; OpenAI-compat chatCompletions endpoint OFF by default; `openrouter` is a builtin provider
id, model ref `openrouter/<org>/<model>`, `OPENROUTER_API_KEY` auto-pickup; `mcp.servers` stdio
keys command/args/env/cwd, remote keys url/transport(streamable-http|sse)/headers/auth/sslVerify/
requestTimeoutMs(default 60s; 10s initial tool list)/connectionTimeoutMs, `toolFilter.include/
exclude` (globs ok), stdio env safety filter drops NODE_OPTIONS/DYLD_*; stdio server stderr →
gateway log prefixed `bundle-mcp:<name>:`; `tools.allow/deny` deny-wins, `tools.profile`
minimal|coding|messaging|full; sandbox modes off|non-main|all, backends docker|podman|ssh|
openshell|crabbox — **no macOS seatbelt backend** (skipped phase 1; revisit if Docker lands on
mini); with sandbox on, MCP tools need `"bundle-mcp"` in `tools.sandbox.tools.alsoAllow`;
`OPENCLAW_NIX_MODE=1` ⇒ writers (onboard/doctor --fix/config set/plugin install) refuse and print
redacted merge patches; state dir must stay writable; default logs /tmp/openclaw pruned 24h ⇒
`logging.file`; `openclaw config schema` / `openclaw config validate` exist for offline checks;
upstream reference impl: `openclaw/nix-openclaw` Home Manager module.

### Deployment facts discovered

- Locked nixpkgs-unstable ships openclaw **2026.10.5** (vendored docs/subtree = 2026.10.3;
  patch skew — re-validate schema on mini; `allowInsecurePredicate` already version-proof).
- **No binary cache for openclaw on aarch64-darwin** (insecure-marked ⇒ Hydra skips) ⇒ first
  `darwin-rebuild` on mini builds from source (pnpm install+build+ui:build — expect tens of
  minutes, one-time).
- sops-nix darwin (rev `ee48786`, read from store): secrets → `/run/secrets/<name>` via
  `launchd.daemons.sops-install-secrets` (RunAtLoad) + postActivation; owner/group/mode
  supported; `neededForUsers` is a no-op on macOS. **sops-install-secrets FAILS if a declared key
  is missing from mini.yaml ⇒ jacob must add the 3 keys BEFORE first switch** (or the activation
  errors — recoverable, but let's not).
- Verified on linux (eval-only): toplevel drvPath ✓, rendered config text ✓ (literal
  `${KAGI_API_KEY}` ✓), plist ✓ (Label/KeepAlive/RunAtLoad/wait4path/StandardOutPath), wrapper
  shell syntax ✓. No Linux host configs touched (openclaw feature is darwin-only data).

### jacob: phase-1 deploy checklist

1. Add secrets (workstation, your age key): `sops nix-config/secrets/mini.yaml` →
   ```yaml
   openclaw_gateway_token: <openssl rand -hex 32>
   openrouter_api_key: <sk-or-...>
   kagi_api_key: <key from kagi.com/api/keys — needs API credits enabled>
   ```
2. On mini: `darwin-rebuild switch --flake <repo>#mini` (first build = source build, see above).
3. Smoke test: `openclaw gateway status` (or `launchctl print gui/501/org.nixos.openclaw | head`)
   → `openclaw config validate` → `tail ~/Library/Logs/openclaw/gateway.log` → Control UI at
   `http://127.0.0.1:18789/` (token = gateway_token value) → ask it something that uses
   `kagi_search_fetch`.
4. Append results (esp. any schema drift at 2026.10.5) to this log.

### Phase 2 research in flight (launched this session)

- `ses_e5262a4a9ffehwu4f2peQ9cj7k` — Effect `McpServer` exact API extraction (import paths,
  layerStdio/Tool/Toolkit signatures, runnable example from tests, error handling, middleware).
- `ses_e52624c0cffehoCb7XrgdxRcS2` — Proton Bridge IMAP semantics (labels-as-folders?, MOVE/COPY,
  SEARCH support, TLS/ports, macOS GUI requirement) + ImapFlow/mailparser API patterns.
- Design consequence to verify from research: Proton "labels" are likely IMAP **folders**
  (Labels/*), so `mail_add_label` = COPY/MOVE into a whitelisted label folder — the whitelist
  env semantics may shift from flags to folder names. Resolve when research lands, BEFORE writing
  the tools layer.

---

## 2026-11-05 — Session 1 (part 2): decisions received; Effect MCP + monorepo research

### User decisions (ALL open questions resolved)

1. Mail MCP → **build first-party** Effect-based server (`packages/proton-mail-mcp`);
   `repos/proton-mcp` stays vendored as reference only.
2. Authority → **read + labeling**, granular **env-configured whitelists**
   (`PROTON_MCP_OPERATIONS`, `PROTON_MCP_ALLOWED_LABELS`); server must only _register_ permitted
   tools; no send/delete/trash. Architecture per homelab-services/-node/shared patterns.
3. **Proton Mail Bridge on mini → approved.**
4. LLM provider → **OpenRouter API key** (sops `openrouter_api_key`).
5. Channels → **Control UI / WebChat only** initially.
6. Auto-login → **yes** (`system.defaults.loginwindow.autoLoginUser = "jacob"`; option confirmed
   in vendored `repos/nix-darwin/modules/system/defaults/loginwindow.nix:18`; FileVault caveat
   noted in plan D2).
7. UI exposure → phase 3 tailnet Caddy vhost at **`openclaw.plato-splunk.media`** (jacob's chosen
   domain) — **must be added to Technitium provisioning**: `openclaw = mkCatalogDns "openclaw"
   "openclaw" "mini";` in `service-registry.nix` `catalogDns` ("# mini services" block). DNS flow
   confirmed: flake-level `catalogDns` aggregate → `homelab-service-dns` generator (aedilis-only;
   per-host catalogs are NOT visible cross-host) → `technitium-provisioning` upserts. Plus
   per-host intent entry `homelab.catalog.openclaw` (`dns.tailnet`, `managedBy.caddy/dns`) in
   `features/openclaw/catalog.nix` for the darwin caddy generator.

### Effect MCP research (subagent `ses_e529bed4affeZIabnd2RJ6Lq98`)

- **Effect v4.1.2 core ships the full MCP server** — `effect/ai/McpServer` (`layerStdio({ name,
  version, protocols, registrations })`, NDJSON-RPC over stdio; also `layerHttp`), `Tool.make` +
  `Toolkit.make` (Schema-typed params), `McpProtocol.v2025_03_26/v2025_06_18/v2025_11_25/
  v2026_07_28`, `McpServer.middleware`/`visibility` for per-request gating. No external MCP SDK
  needed.
- Stdio supply: `NodeStdio.layer` from `@effect/platform-node`
  (`repos/effect/packages/platform/node/src/NodeStdio.ts`).
- Examples/tests to copy from: `repos/effect/packages/effect/test/ai/McpServer/`
  (`RequestDependencies.test.ts` — Toolkit+Layer wiring; `McpServer.test.ts:3315` — stdio wire
  test w/ `Stdio.layerTest`; `McpConformance/`). Tool params example: `ai-docs/src/71_ai/20_tools.ts`.
- Vendored effect = **4.1.2 = exact monorepo pin** (`yarn.lock` → `effect@npm:4.1.2`). No
  workspace package depends on `@effect/ai*` provider adapters yet (not needed for an MCP server).
- `@effect/rpc` merged into core v4; McpServer is built on it internally — use McpServer, not raw RPC.
- Effect-repo skill docs: `repos/effect/.agents/skills/*/SKILL.md` (repo-development oriented;
  `effect-development` points to `ai-docs/src/71_ai/` + generated `repos/effect/LLMS.md`).

### Monorepo / Nix packaging research (subagent `ses_e529ba533ffeHpiFV9Otpgz967`)

- Library packages export **TS sources directly** (`exports → ./src/index.ts`); only deployables
  bundle (`rolldown -c` → `dist/bundle/`, e.g. homelab-server). ESM everywhere; yarn 4.14.1;
  `.yarnrc.yml` = `nodeLinker: node-modules` → **`docs/nix-nodejs-services.md` PnP sections are
  stale** (bundle+wrapper pattern still valid).
- New-package checklist: `package.json` (type module; scripts lint/typecheck/test[/build];
  workspace:* deps), `tsconfig.json` + `tsconfig.src.json` (extends `../../tsconfig.base.json`,
  noEmit, types node), `vitest.config.ts` (`mergeConfig` from `../../vitest.shared.js`),
  `eslint.config.mjs` (re-export root config), `rolldown.config.js` (see homelab-server's
  `stubOptionalNative` plugin). Root `yarn lint/typecheck/test` (workspaces foreach) auto-picks
  up new packages.
- Env/config pattern: tag in `homelab-services/src/config/env.ts`
  (`Context.Service<Env, EnvDef>()("homelab-api/config/env/Env")`) + `EnvLive` with
  `Config.schema`/`Config.withDefault` in `homelab-server/src/env.ts`; layer composition in
  `homelab-server/src/main.ts` (`Layer.provide` chain + `NodeRuntime.runMain`).
- Nix: mirror `nix-config/modules/features/homelab-api/package.nix` — nix-filter over monorepo →
  `fetchYarnBerryDeps` (fixed hash + `${self}/missing-hashes.json`, `YARN_ENABLE_SCRIPTS=0`) →
  `yarn workspace <pkg> build` → copy `dist/bundle` → `$out/bin` wrapper on `nodejs_26`.
  `flake.packages` currently exposes x86_64-linux + aarch64-linux → **add aarch64-darwin**
  (flake `systems` already includes it; bundle output is platform-neutral JS).
- After any `yarn.lock` change (new deps: imapflow, mailparser): refresh `fetchYarnBerryDeps`
  hash per `nix-hashes` skill + regenerate `missing-hashes.json`.

### Plan status

`docs/openclaw-mini-plan.md` → **PLAN COMPLETE, ready for implementation** (phases 1–3, step
checklist, package blueprint, all decisions D1–D8). Nothing implemented in nix-config/packages yet.

---

## 2026-11-05 — Session 1: research, vendoring, security audit (planning only; nothing deployed)

### Git state

- Worktree branch (off `main`), commits so far:
  - `597e1ab556e3` — merge: subtree add `repos/proton-mcp/` (squashed `90ab1a2dd30b`,
    upstream `jorgenclaw/proton-mcp` `main` @ `37391294d62a4f76ee9e99849644682d0a9b08a4`)
  - plan + this log (docs/openclaw-mini-plan.md, docs/openclaw-mini-progress.md)
- No nix-config changes yet. No secrets added. mini untouched.

### Repo-pattern findings (mini / darwin)

- mini = nix-darwin aarch64; modules: `darwin-base`, `nixvim-complete`, `homebrew`,
  `homelab-service-apphost` (darwin Caddy catalog generator), `mini-jellyfin`, `_private/mini/*`.
- Only launchd unit today: `launchd.daemons.caddy` (features/mini-jellyfin/caddy-host.nix).
  `launchd.user.agents.<name>` (vendored `repos/nix-darwin/modules/launchd/default.nix` line 171)
  → `environment.userLaunchAgents` → `~primaryUser/Library/LaunchAgents`; `system.primaryUser =
  "jacob"` already set. First user-agent on any host if we proceed.
- mini's nixpkgs follows 26.05 (no pkgs-unstable specialArgs yet — Linux hosts pattern:
  `hosts/nixos.nix` line 10). openclaw: 26.05 = v2026.5.7 (stale), unstable = v2026.10.3.
- sops on mini configured (`_private/mini/sops.nix`; `secrets/mini.yaml` has only `example`) but
  **never exercised** — verify darwin secret paths/ownership when first consumed.
- No home-manager on mini. Feature pattern: `features/<name>/{complete,service|catalog,...}.nix`
  registering `flake.modules.darwin.<name>` (import-tree picks up files automatically).

### OpenClaw research (subagent `ses_e52b16b7effe2SzEMJJNOqkBzO`; sources: upstream docs, tag v2026.10.3)

- Foreground command for launchd: **`openclaw gateway run`** (invalid config → exit 78).
  `openclaw gateway install` manages its own LaunchAgent (label `ai.openclaw.gateway`) — we use
  nix-managed `launchd.user.agents` instead; then set **`OPENCLAW_SERVICE_REPAIR_POLICY=external`**
  so `openclaw doctor` won't fight Nix. Root LaunchDaemons unsupported upstream.
- Config: **`~/.openclaw/openclaw.json`**, JSON5, **strict schema** (unknown keys refuse start;
  `openclaw doctor --fix`). Overrides: `OPENCLAW_CONFIG_PATH`, `OPENCLAW_STATE_DIR`. Supports
  `$include` + `${VAR}` env substitution. State/creds/sessions in `~/.openclaw/`.
- Gateway: single port **18789**, default **loopback**, auth on by default
  (`OPENCLAW_GATEWAY_TOKEN`); serves WS control + OpenAI-compatible HTTP + Control UI at `/`.
- **Native MCP** in config `mcp.servers` (verified present at v2026.10.3): stdio/SSE/
  streamable-http, per-server `toolFilter: { include: [...] }` — this is how we enforce the
  read-only mail policy. mcporter NOT needed. CLI: `openclaw mcp add|doctor|probe|login`.
- Provider auth: `openclaw onboard` (OAuth for Anthropic/Codex, API keys), or env
  (`ANTHROPIC_API_KEY` etc.), `~/.openclaw/.env`, config `env.vars`, SecretRefs.
- Security: prompt-injection `knownVulnerabilities` in nixpkgs meta; sandboxing **off by
  default** (`agents.defaults.sandbox`); DM pairing + `channels.<ch>.allowFrom`; logs
  `~/Library/Logs/openclaw/`.
- Verify exact JSON5 schema against **bundled docs** after build:
  `result/lib/openclaw/docs/` (esp. `gateway/configuration.md`, `tools/mcp.md`,
  `platforms/mac/bundled-gateway.md`) — derivation copies `docs/` into `$libdir`.

### Kagi MCP research (subagent `ses_e52b11972ffeyXfzov5QsqXEcn`)

- **Hosted remote MCP confirmed**: `https://mcp.kagi.com/mcp`, streamable HTTP,
  `Authorization: Bearer <KAGI_API_KEY>` (key: https://kagi.com/api/keys; no OAuth yet).
- Tools: `kagi_search_fetch`, `kagi_extract` (fastgpt/summarizer removed upstream for now).
- Billing: separate pay-per-use API credits (Search $12/1k, Extract $4/1k) — NOT the consumer
  subscription. Local PyPI alternative (`uvx kagimcp`) exists; remote = lowest friction.
- Official org repo, actively maintained (bursts Oct 2026, v1.1.0).

### amotivv/protonmail-mcp research (subagent `ses_e52b13e98ffe3HHwr7Wfh0NK7v`)

- Confirmed **send-only** (single `send_email` tool, nodemailer → smtp.protonmail.ch, Bridge-
  generated SMTP password). Abandoned since 2025-03. Not on npm. **Dropped from plan.**
- Alternatives surveyed: `sethbang/proton-mail-mcp` (npm, Node 24+, full read/search/labels/
  send, Apr-2026), `mhbxyz/protonmail-mcp` (read-only hardened), `googlarz/proton-mail-bridge-
  client` (116 tools), `ichiburn/protonmail-mcp` (Go, SRP+TOTP direct-API, ToS-risky). No
  official Proton AG MCP server exists (as of Nov 2026).

### proton-mcp security audit (subagent `ses_e52a8f06effeC3NGNoeVdirqwt`)

Repo metadata red flags (pre-audit): created 2026-04-01, single push 3 min later, never updated;
brand-new owner account; 29 KB claiming "36 tools × 5 Proton suites"; no tags/releases/npm.
README admits: "Built by Scott Jorgensen and Jorgenclaw (AI agent) for jorgenclaw.ai".

**VERDICT: SUSPICIOUS — AI-generated slop + misleading claims; NO evidence of a credential-
stealing backdoor. Do not deploy as-is.**

Clean: no `eval`/`Function`/`atob`/hex/charcode obfuscation; no install hooks (`scripts` absent);
all ~84 lockfile entries `registry.npmjs.org` + sha512; no env harvesting; no FS scanning;
zero console/file writes; `execFile` with array args only; no session persistence.

Findings:

| Sev  | Location                                    | Finding                                                                                                                                                                                                                           |
| ---- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH | `calendar-client.js:11-14`                  | Hardcoded author creds (`jorgenclaw`/`nanoclaw-cal`) Basic-authed over **http** to `127.0.0.1:5232` — Radicale CalDAV, **not Proton** (Proton Calendar has no CalDAV → module cannot work; leaks creds to anything on your :5232) |
| HIGH | `index.js:409-432,512-525`                  | Design-level prompt-injection exfil chain: `pass__get_item` (raw vault passwords) + `pass__get_totp` (live 2FA codes) + `mail__send_message`/`drive__upload` in one agent context                                                 |
| MED  | `vpn/vpn-client.js:27`                      | Only external URL: `https://ipinfo.io/json` (public-IP disclosure, no creds); "VPN status" = org-name regex, not Proton VPN                                                                                                       |
| MED  | `index.js:42-49` vs README/.env.example     | Code reads `PROTON_BRIDGE_USERNAME/_PASSWORD/_IMAP_HOST`; docs say `_USER/_PASS/_HOST` → README config silently fails (never tested)                                                                                              |
| MED  | `pass-client.js:64`                         | Vault password passed via `execFile` argv (visible in process list)                                                                                                                                                               |
| MED  | `package.json:11`                           | `"@modelcontextprotocol/sdk": "latest"` floating; `zod` imported but undeclared                                                                                                                                                   |
| LOW  | `imap-client.js:19`, `smtp-client.js:13,18` | `tls:false`, `rejectUnauthorized:false` — OK for localhost Bridge, but host is env/config-controllable                                                                                                                            |
| LOW  | `index.js:26-39`                            | Creds read from `~/.proton-mcp/bridge.json`                                                                                                                                                                                       |

Mail tool inventory (15 actual; Bridge IMAP): READ-ONLY `mail__get_unread`,
`mail__list_messages`, `mail__get_message`, `mail__search_messages`, `mail__get_thread`,
`mail__list_folders`, `mail__list_folder_messages`, `mail__get_attachments`; MUTATING
`mail__send_message`, `mail__reply_message`, `mail__forward_message`, `mail__delete_message`,
`mail__move_message`, `mail__mark_message`, `mail__star_message`. Plus Pass(9)/Drive(6)/
Calendar(5)/VPN(1) — all to be denied/removed for our use.

Audit recommendation (verbatim): "Do not give it your credentials as-is. If used at all: strip
`mail__send/reply/forward/delete/move`, deny all `pass__*` tools, fix the env-var mismatch,
remove calendar/vpn modules (facades), and pin the SDK version."

### Pending user decisions — **ALL RESOLVED in part 2 above** (build-first-party mail MCP w/

### env-whitelisted read+label; Bridge yes; OpenRouter; WebChat-only; auto-login yes;

### openclaw.plato-splunk.media phase-3 vhost + Technitium provisioning).

### Next actions for the implementing agent

Follow `docs/openclaw-mini-plan.md` §Implementation Steps (phases 1–3). Quick orientation:

1. Phase 1 first (gateway + Kagi; no dependency on the mail server): `pkgs-unstable` specialArgs
   in `hosts/mini.nix` → `features/openclaw/{complete,service}.nix` → sops keys (jacob runs
   sops; agent surfaces commands) → deploy on mini → port-assignments doc → commit `--no-verify`.
2. Before writing openclaw.json: build openclaw once and read `result/lib/openclaw/docs/`
   (esp. `gateway/configuration.md`, `tools/mcp.md`) — strict schema, exit 78 on unknown keys.
3. Phase 2 (`packages/proton-mail-mcp`): scaffold per blueprint; copy composition patterns from
   `homelab-server/src/main.ts`; MCP wiring from `repos/effect/packages/effect/test/ai/McpServer/`;
   policy-gated tool registration is the core security property — test it.
4. Phase 3: catalog.nix vhost + `catalogDns` entry (Technitium provisioning flows automatically
   via aedilis); verify resolution + vhost from the tailnet.
5. Housekeeping: `git add` new .nix/.ts files before nix eval; nix-hashes skill after yarn.lock
   changes; validation skill before commits; append progress entries here (newest first).

### Cost-control note

Research/audit subagents ran on `qwencloud-token-plan-personal/qwen3.8-flash`. Their session IDs
are listed above if follow-up questions are needed (e.g. re-ask the audit agent about a specific
file — it has the full repo in context).
