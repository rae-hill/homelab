# OpenClaw on mini — Progress & Handoff Log

Living document. Plan: [./openclaw-mini-plan.md](./openclaw-mini-plan.md).
Newest entries first. Agents: append, don't rewrite history.

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
