# Plan: OpenClaw on mini (nix-darwin)

Status: **PLAN COMPLETE — ready for implementation** (all decisions resolved; research done).
Phases: 1) gateway+Kagi on mini, 2) first-party `proton-mail-mcp` (Effect MCP over Bridge IMAP),
3) `openclaw.plato-splunk.media` tailnet vhost + Technitium DNS.
Date: 2026-11-05
Progress/handoff log: [./openclaw-mini-progress.md](./openclaw-mini-progress.md)

## Overview

Deploy [OpenClaw](https://github.com/openclaw/openclaw) (formerly Clawdbot/Moltbot) — a
self-hosted AI assistant/agent — on **mini** (aarch64-darwin Mac Mini, nix-darwin), running
**as user `jacob`**, with MCP tool servers wired in:

1. **Kagi Search** — Kagi's _hosted remote_ MCP server (`https://mcp.kagi.com/mcp`, streamable
   HTTP, Bearer API key). No local process needed.
2. **Proton Mail (read + label)** — a **first-party MCP server built in this monorepo**
   (`packages/`, Effect-based, following the homelab-services/-node/shared architecture), talking
   IMAP to **Proton Mail Bridge on mini** (decision: Bridge = yes). Operations whitelisted via
   env config: read/search/list by default + **labeling only** (granular: only whitelisted
   flags/labels can be applied); no send/delete/trash. Runs as a _local stdio_ process on mini
   (full-mailbox blast radius → stays local, never remote). The third-party candidate
   `jorgenclaw/proton-mcp` was audited → **SUSPICIOUS, rejected as-is**; it stays vendored at
   `repos/proton-mcp/` as a reference foil only.

Use cases: mailbox triage/cleanup + surfacing important items; web search via Kagi; chat-channel
control (channels TBD — OpenClaw supports WhatsApp, Telegram, Discord, Slack, Signal, iMessage, …).

## Service Details

| Property     | Value                                                                            |
| ------------ | -------------------------------------------------------------------------------- |
| Service name | `openclaw`                                                                       |
| Package      | `pkgs-unstable.openclaw` (v2026.10.3; nixpkgs-26.05 has stale 2026.5.7)          |
| Run command  | `openclaw gateway run` (foreground, launchd-managed)                             |
| Run as       | user `jacob` (`launchd.user.agents` → `~/Library/LaunchAgents`)                  |
| Port         | `18789` (TCP, **127.0.0.1 only** — gateway WS + OpenAI-compat HTTP + Control UI) |
| Config       | `/etc/openclaw/openclaw.json` (JSON5, Nix-managed) via `OPENCLAW_CONFIG_PATH`    |
| State        | `~/.openclaw/` (mutable: sessions, credentials, workspace)                       |
| Secrets      | sops `nix-config/secrets/mini.yaml` → env vars (never in config text)            |
| Gateway auth | token on by default; `OPENCLAW_GATEWAY_TOKEN` from sops                          |
| Host         | mini                                                                             |

---

## Decisions

### D1 — Package from `pkgs-unstable`

OpenClaw moves fast (upstream verified `mcp.servers` native MCP support at v2026.10.3; the
26.05 package is v2026.5.7 and may lack it). Wire `pkgs-unstable` into mini's `darwinSystem`
`specialArgs`, mirroring the Linux hosts (`hosts/nixos.nix` line 10):

```nix
# hosts/mini.nix
specialArgs = {
  inherit inputs;
  pkgs-unstable = import inputs.nixpkgs-unstable {
    system = "aarch64-darwin";
    config.allowUnfree = true;
  };
};
```

### D2 — `launchd.user.agents`, not a root daemon

- Upstream macOS guidance: **per-user LaunchAgent only** (label `ai.openclaw.gateway` upstream;
  root LaunchDaemons explicitly unsupported). iMessage channel + keychain require an Aqua session.
- nix-darwin `launchd.user.agents.<name>` installs into `~jacob/Library/LaunchAgents`
  (`environment.userLaunchAgents`, tied to `system.primaryUser = "jacob"` — already set on mini).
- Requirement: jacob must have a logged-in GUI session. **DECIDED:** enable auto-login via
  `system.defaults.loginwindow.autoLoginUser = "jacob"` (vendored nix-darwin
  `modules/system/defaults/loginwindow.nix`). ⚠ FileVault caveat: with FileVault on, macOS
  demands an unlock at boot before auto-login — if mini runs FileVault, accept post-unlock
  semantics or disable it (jacob's call at implementation; record in progress log).
- Since Nix owns the plist (not `openclaw gateway install`), set
  `OPENCLAW_SERVICE_REPAIR_POLICY=external` in the agent environment so `openclaw doctor`
  doesn't try to "repair" the service definition.
- Alternative considered: `launchd.daemons` with `UserName = "jacob"` (starts at boot, no login
  needed) — rejected: no Aqua session, unsupported by upstream, breaks iMessage/keychain paths.

### D3 — Declarative config + mutable state split

- Nix renders `environment.etc."openclaw/openclaw.json".text` (JSON5) with the _skeleton_:
  `gateway` (port/bind/auth mode), `models.providers`, `mcp.servers`, tool policies, sandboxing.
  Agent env sets `OPENCLAW_CONFIG_PATH=/etc/openclaw/openclaw.json`.
- State (`~/.openclaw/`: sessions, auth profiles, credentials, workspace) stays mutable and
  user-owned. Interactive bits (`openclaw onboard` for provider OAuth, channel pairing) write
  there. Config is **strict-schema**: verify every key against the bundled docs
  (`nix build` → `$out/lib/openclaw/docs/`) before deploying — unknown keys refuse startup (exit 78).
- Env-var substitution (`${VAR}`) keeps secrets out of the Nix-rendered config.
- ⚠ If `openclaw onboard` insists on writing its own config file, revisit: either let onboard own
  `~/.openclaw/openclaw.json` and manage only an `$include`d fragment, or run onboard against the
  etc path with a writable `OPENCLAW_STATE_DIR`. Resolve during implementation (progress log).

### D4 — Secrets via sops

mini already has sops-nix wired (`_private/mini/sops.nix`, age key at
`~/Library/Application Support/sops/age/keys.txt`); `mini.yaml` currently holds only `example`.
Add keys (names final at implementation):

| sops key                 | Consumer                      | Notes                                               |
| ------------------------ | ----------------------------- | --------------------------------------------------- |
| `openclaw_gateway_token` | `OPENCLAW_GATEWAY_TOKEN`      | gateway WS/UI auth                                  |
| `kagi_api_key`           | `KAGI_API_KEY`                | Bearer → mcp.kagi.com                               |
| `openrouter_api_key`     | `OPENROUTER_API_KEY`          | LLM provider — **DECIDED: OpenRouter**              |
| `proton_bridge_username` | proton-mail-mcp env (phase 2) | Bridge mailbox address                              |
| `proton_bridge_password` | proton-mail-mcp env (phase 2) | Bridge mailbox password (NOT account pw; revocable) |

Secrets are injected as launchd agent `EnvironmentVariables` (or `EnvironmentVariables` reading
`sops.secrets.<key>.path` via a wrapper script — launchd plists can't inline file contents).
Verify sops-nix **darwin** secret paths/ownership are readable by user `jacob`
(`sops.secrets.<key>.owner = config.users.knownUsers…`/`mode`) — mini's sops setup is
untested in practice (no consumers yet).

### D5 — Port 18789 loopback; **DECIDED domain: `openclaw.plato-splunk.media`** (phase-3 vhost)

Gateway binds 127.0.0.1 (default) and stays there — mini's Caddy terminates the tailnet vhost.

- **Phase 1:** access locally via `openclaw dashboard` or Tailscale SSH port-forward. Update
  `docs/port-assignments.md` (Mini table: 18789, 127.0.0.1).
- **Phase 3 (DECIDED):** `openclaw.plato-splunk.media` → mini tailnet address → mini Caddy →
  127.0.0.1:18789, same darwin-catalog pattern as `jellyfin`. **mTLS-gated** (jacob 2026-11-09:
  "lock agents down with mTLS"; iPad/iPhone hold client certs): `tls.gate.mtls.trustPoolFile`
  = step-ca root → rendered `client_auth require_and_verify`; server cert stays Caddy-native
  ACME (`cert.shared`). Gateway token auth remains active behind mTLS (two factors: cert +
  token). Devices without a client cert fail the TLS handshake (by design).
- **Technitium provisioning (jacob's requirement):** DNS flows from the flake-level `catalogDns`
  aggregate in `service-registry.nix` — the `homelab-service-dns` generator (aedilis-only) folds
  it and upserts records into Technitium via `technitium-provisioning`. Add
  `openclaw = mkCatalogDns "openclaw" "openclaw" "mini";` under "# mini services", plus the
  per-host `homelab.catalog.openclaw` entry (`features/openclaw/catalog.nix`, darwin) declaring
  `dns.tailnet = {}` + `managedBy = { caddy = true; dns = true; }` as intent (the darwin caddy
  generator renders the vhost into `catalog-sites.caddy`).

### D6 — First-party mail MCP server on Effect's built-in MCP stack

**Effect v4.1.2 — the exact version this monorepo already consumes — ships MCP server support in
core** (`effect/ai/McpServer`); no `@modelcontextprotocol/sdk` dependency needed. Design
blueprint: §MCP Servers → Proton Mail.

### D7 — LLM provider: OpenRouter

`OPENROUTER_API_KEY` (sops) + `models.providers` config; model chosen via
`agents.defaults.model.primary` (exact provider/model ids verified against OpenClaw's bundled
docs at implementation).

### D8 — Channels: Control UI / WebChat only (phase 1)

No chat channels initially — no channel secrets, smallest surface. iMessage/Telegram can follow
later (iMessage needs the Aqua session that auto-login now provides).

---

## Nix module layout

Follow the `mini-jellyfin` feature pattern (darwin modules registered as
`flake.modules.darwin.<name>`, imported via `import-tree`, aggregated in `complete.nix`):

```
nix-config/modules/features/openclaw/
├── complete.nix          # flake.modules.darwin.openclaw — imports service + mail-mcp-package (+ catalog)
├── service.nix           # launchd.user.agents.openclaw, environment.etc config, sops secret
│                         #   wiring, system.defaults.loginwindow.autoLoginUser
├── mail-mcp-package.nix  # proton-mail-mcp derivation (fetchYarnBerryDeps pattern) → flake.packages.aarch64-darwin
└── catalog.nix           # phase 3: homelab.catalog.openclaw vhost (darwin caddy generator)

packages/proton-mail-mcp/       # first-party Effect MCP server (new yarn workspace package, phase 2)
```

```nix
# service.nix sketch (JSON5 text rendered by Nix; secrets via env only)
flake.modules.darwin.openclaw = { pkgs-unstable, config, ... }: {
  environment.systemPackages = [ pkgs-unstable.openclaw ];

  environment.etc."openclaw/openclaw.json".text = /* JSON5 skeleton */ "";

  sops.secrets.openclaw_gateway_token.owner = "jacob"; # + kagi_api_key, provider key, proton creds

  launchd.user.agents.openclaw = {
    command = "${pkgs-unstable.openclaw}/bin/openclaw gateway run";
    environment = {
      OPENCLAW_CONFIG_PATH = "/etc/openclaw/openclaw.json";
      OPENCLAW_SERVICE_REPAIR_POLICY = "external";
      # OPENCLAW_GATEWAY_TOKEN / KAGI_API_KEY / ANTHROPIC_API_KEY — from sops paths,
      # likely via a small wrapper script that `cat`s the secret files into env.
    };
    serviceConfig = {
      KeepAlive = true;
      RunAtLoad = true;
      StandardOutPath = "/Users/jacob/Library/Logs/openclaw/gateway.out.log";
      StandardErrorPath = "/Users/jacob/Library/Logs/openclaw/gateway.err.log";
    };
  };
};
```

Then add `darwin.openclaw` to `hosts/mini.nix` module list.

---

## MCP Servers

OpenClaw has **native MCP support** (`mcp.servers` in config, v2026.10.3): stdio, SSE, and
streamable HTTP transports, with per-server `toolFilter` include/exclude — no `mcporter` bridge
needed (it remains packaged for legacy CLI use). Exact config schema to be verified against
bundled `docs/tools/mcp.md` at implementation time.

### Kagi (remote — settled)

```json5
mcp: {
  servers: {
    kagi: {
      url: "https://mcp.kagi.com/mcp",
      transport: "streamable-http",
      enabled: true,
      headers: { Authorization: "Bearer ${KAGI_API_KEY}" }, // verify key name in docs
    },
  },
}
```

- Tools: `kagi_search_fetch` (web/news/video search), `kagi_extract` (page → markdown).
  (`fastgpt`/`summarizer` currently removed upstream.)
- Billing: separate **pay-per-use Kagi API** credits (Search $12/1k, Extract $4/1k) — NOT covered
  by a consumer Kagi subscription. Key from https://kagi.com/api/keys.
- Lowest-friction option: no local Python/uv toolchain.

### Proton Mail (local — **DECIDED: first-party Effect-based server**)

Decision (jacob, 2026-11-05): **build our own** MCP server in `packages/` using Effect, over
**Proton Mail Bridge IMAP** on mini (Bridge = approved). Authority: **read + labeling**, with
**env-configurable, granular operation whitelists**. Architecture must follow the repo's
preferred backend patterns (`homelab-services` definitions / `homelab-services-node`
implementations / `shared` / `homelab-server` composition).

Requirements spec for the new package (working name `proton-mail-mcp`):

- **Transport:** MCP stdio server (spawned by OpenClaw's `mcp.servers` entry) built on
  **`effect/ai/McpServer`** — Effect v4.1.2 (the exact version this monorepo consumes) ships the
  full MCP server stack in core: `McpServer.layerStdio({ name, version, protocols, registrations })`
  (NDJSON-RPC over stdio; supply `NodeStdio.layer` from `@effect/platform-node`), `Tool.make` +
  `Toolkit.make` with `Schema`-typed params, protocol adapters `McpProtocol.v2025_03_26 …
  v2026_07_28` (pick the one OpenClaw's client negotiates — verify against bundled
  `docs/tools/mcp.md`), and `McpServer.middleware`/`visibility` for per-request policy gating.
  No external MCP SDK dependency.
- **IMAP:** Proton Bridge on `127.0.0.1` (Bridge-generated mailbox credentials; TLS to localhost
  per Bridge config). Prefer a maintained IMAP client (e.g. ImapFlow) over the abandoned `imap`
  dep the audited repo used.
- **Tool surface (policy-enforced in code, not just client-side):**
  - Read tools: list folders, list messages (paging), get message (headers/body/text), search,
    get thread/conversation, unread counts, get attachments (path-scoped download dir, no exec).
  - Label tools: add/remove labels (IMAP flags + Proton label semantics) **only** for labels on a
    configured whitelist; `mark read/unread`, `star` gated the same way.
  - **Never implemented:** send, reply, forward, delete, expunge, move-to-arbitrary-folder
    (unless a later decision adds trash/archive — env-gated, off by default).
- **Env configuration (granular):** e.g. `PROTON_MCP_OPERATIONS=read,label` and
  `PROTON_MCP_ALLOWED_LABELS=<comma list>`; server registers **only** tools permitted by config
  (defense in depth — the LLM cannot call what isn't registered). Config parsed with the repo's
  Effect `Config` patterns; fail fast on invalid config.
- **Hygiene:** no floating dep versions; no hardcoded creds; structured logging to stderr
  (never log message bodies/credentials); unit tests for policy gating.
- **Packaging:** Nix derivation for aarch64-darwin mirroring
  `nix-config/modules/features/homelab-api/package.nix`: `nix-filter` over the monorepo →
  `fetchYarnBerryDeps` (fixed hash + `missing-hashes.json` — refresh per the `nix-hashes` skill
  after any `yarn.lock` change) → `yarn workspace proton-mail-mcp build` (rolldown bundle) →
  wrapper on `nodejs_26`. OpenClaw `mcp.servers.protonmail.command` points at the built wrapper;
  creds via env from sops secrets. (Note: `docs/nix-nodejs-services.md`'s PnP sections are stale —
  `.yarnrc.yml` uses `nodeLinker: node-modules`.)
- **OpenClaw side:** `mcp.servers.protonmail` stdio entry + `toolFilter` mirroring the env
  policy (belt and suspenders).

#### Package blueprint (`packages/proton-mail-mcp`)

Follows the monorepo's architecture (definitions vs implementations, Layer composition,
Effect `Config`-based env); self-contained package since it's a separate deployable from
homelab-api:

```
packages/proton-mail-mcp/
├── package.json          # type: module; build: rolldown -c; lint/typecheck/test scripts (root
│                         #   `yarn workspaces foreach` picks them up automatically)
├── tsconfig.json / tsconfig.src.json / vitest.config.ts / eslint.config.mjs / rolldown.config.js
└── src/
    ├── main.ts           # McpServer.layerStdio + filtered toolkits + NodeRuntime.runMain
    ├── env.ts            # EnvLive (Config.schema/String): bridge host/port, creds, operations,
    │                     #   allowed labels, body-size caps, log level
    ├── services/         # definitions: ImapMailService (folders/list/get/search/labels), tagged
    │                     #   errors, Schemas for message/label shapes (homelab-services style)
    ├── layers/           # impls: ImapMailServiceLive (ImapFlow + mailparser), PolicyServiceLive
    │                     #   (operations + label whitelist from Env)
    └── tools/            # Tool.make/Toolkit per surface; registrations FILTERED by policy —
                          #   unpermitted tools are never registered
```

Env surface (draft): `PROTON_BRIDGE_IMAP_HOST` (default 127.0.0.1), `PROTON_BRIDGE_IMAP_PORT`
(1143), `PROTON_BRIDGE_USERNAME`, `PROTON_BRIDGE_PASSWORD`, `PROTON_MCP_OPERATIONS` (default
`read`; opt-in `label`), `PROTON_MCP_ALLOWED_LABELS` (required non-empty when `label` enabled),
`PROTON_MCP_MAX_BODY_BYTES` (LLM-context protection). Policy enforced twice in-process — tool
registration (what the LLM can see at all) + argument validation (only whitelisted labels/flags
accepted) — with OpenClaw's `toolFilter` as a third layer.

**DECIDED (2026-11-09): labeling ENABLED** — `PROTON_MCP_OPERATIONS: "read,label"` and
`PROTON_MCP_ALLOWED_LABELS: "Declined,Applied,Needs Follow-Up,Job Hunt"` (exact Proton label
names, case-sensitive; job-hunt triage workflow). Wired in `features/openclaw/service.nix`.

Initial tool set — read: `mail_list_folders`, `mail_list_messages`, `mail_get_message`,
`mail_search_messages`, `mail_get_unread_count`; label (gated): `mail_list_labels`,
`mail_add_label`, `mail_remove_label`, `mail_set_read`, `mail_set_starred`.

Rejected alternative (kept for the record): `jorgenclaw/proton-mcp` — vendored at
`repos/proton-mcp/` (squashed subtree, upstream `main` @ `3739129`), audited 2026-11-05 →
**SUSPICIOUS**: AI-generated slop, never run by its author (README env vars don't match code),
Calendar/VPN modules are facades (hardcoded author Radicale creds → `127.0.0.1:5232`; VPN status
= regex over `ipinfo.io`), floating MCP SDK version, Pass tools expose vault secrets + TOTP into
LLM context alongside `mail__send_message` (prompt-injection exfil chain). No backdoor/exfil
endpoint found — but not worth patching when a first-party server is this scoped. Full findings
table: progress log. Its Bridge-IMAP mail architecture and tool naming remain a useful reference.

Auth model note: Bridge credentials are mailbox-scoped and revocable without touching the Proton
account — the reason Bridge was chosen over direct-API/SRP servers (which need the real account
password + 2FA material: bigger blast radius, ToS-gray).

---

## Security Considerations

- **Prompt injection is the core risk** (upstream `knownVulnerabilities` says it plainly: LLMs
  parse untrusted content with full system access by default). Email bodies are untrusted input.
  Mitigations: tool allowlists (read-only mail tools only), `agents.defaults.sandbox` enabled
  (off by default!), exec approvals on, DM pairing + `channels.<ch>.allowFrom` allowlists,
  gateway bound to loopback with token auth, `openclaw security audit` periodically.
- **Mailbox blast radius:** proton MCP stays a local stdio process on mini; credentials only in
  sops-encrypted secrets; prefer Bridge-generated credentials over account password.
- **Supply chain:** audit gate on any third-party MCP server before it receives credentials;
  subtree-vendor + pin exact commits (done for proton-mcp); re-audit on every bump.
- **Gateway auth:** token on by default; token lives in sops, not the Nix-rendered config.
- One trust boundary per gateway: this instance is jacob's personal agent; never expose the
  gateway off-loopback.

## Validation & housekeeping

1. `nix flake check` / `nix build .#darwinConfigurations.mini…` (eval gate; remember: `git add`
   new `.nix` files before evaluating).
2. Update `docs/port-assignments.md` → Mini table: `18789 | OpenClaw gateway | TCP | 127.0.0.1`.
3. Phase 3 (decided): add `openclaw = mkCatalogDns "openclaw" "openclaw" "mini";` to the
   `catalogDns` map in `service-registry.nix` ("# mini services" block) — that aggregate is what
   the aedilis DNS generator folds into Technitium provisioning — plus the
   `features/openclaw/catalog.nix` vhost entry.
4. Deploy: `darwin-rebuild switch --flake .#mini` on mini (add a `remote-build-mini` devshell
   command? mini builds locally — open question).

## Implementation Steps

**Phase 1 — OpenClaw gateway + Kagi on mini:**

1. [x] Wire `pkgs-unstable` specialArgs into `hosts/mini.nix`; verify openclaw builds/caches for
       aarch64-darwin; read bundled docs (`result/lib/openclaw/docs/`) to lock the exact config
       schema: `mcp.servers` shape (stdio + streamable-http), `toolFilter`, `${VAR}` substitution
       in headers/env, OpenRouter provider/model ids, MCP protocol version compatibility.
2. [x] Create `features/openclaw/{complete,service}.nix` per plan sketch (launchd.user.agents,
       etc-rendered JSON5 config, sops wiring, auto-login, `OPENCLAW_SERVICE_REPAIR_POLICY=external`);
       register `darwin.openclaw` in `hosts/mini.nix`. `git add` new .nix files before nix eval.
3. [ ] jacob: add sops keys to `secrets/mini.yaml` (`openclaw_gateway_token`, `kagi_api_key`,
       `openrouter_api_key`) — agent surfaces exact `sops` commands (sops denied for agents).
4. [ ] Render config skeleton (gateway loopback+token, OpenRouter model, kagi `mcp.servers`
       entry); deploy `darwin-rebuild switch --flake .#mini` on mini; smoke-test Control UI +
       a Kagi search round-trip.
5. [x] Update `docs/port-assignments.md` (Mini: 18789 OpenClaw gateway, 127.0.0.1); run
       validation; commit `--no-verify`.

**Phase 2 — first-party Proton Mail MCP server:**

6. [x] Scaffold `packages/proton-mail-mcp` per blueprint (package.json/tsconfigs/vitest/eslint/
       rolldown); add pinned deps (imapflow, mailparser); refresh `fetchYarnBerryDeps` hash +
       `missing-hashes.json` (nix-hashes skill).
7. [x] Implement env config + policy layer + IMAP service (definitions/impls split); read tools
       first, label tools behind `PROTON_MCP_OPERATIONS`+`PROTON_MCP_ALLOWED_LABELS`; unit tests
       for policy gating (@effect/vitest), incl. "unpermitted tool is never registered".
8. [x] `mail-mcp-package.nix` derivation (homelab-api pattern, aarch64-darwin); wire
       `mcp.servers.protonmail` (stdio) into the openclaw config with `${VAR}`-substituted Bridge
       creds; add `proton_bridge_username`/`proton_bridge_password` sops keys.
9. [ ] jacob: install + log in to Proton Mail Bridge on mini (paid plan); decide Bridge
       supervision (manual / launchd / Bridge autostart); end-to-end mailbox-triage test through
       OpenClaw ("what's important? clean up my inbox with label X").

**Phase 3 — UI exposure `openclaw.plato-splunk.media`:**

10. [x] `features/openclaw/catalog.nix`: `openclaw` vhost (`backend.reverseProxy.port = 18789`,
        `tls.cert.shared`, `dns.tailnet`, `managedBy = { caddy = true; dns = true; }`) +
        `catalogDns` entry in `service-registry.nix` → Technitium provisioning on aedilis picks
        it up automatically (upsert). Verified via eval: A/AAAA `openclaw.plato-splunk.media` →
        mini tailnet addrs in aedilis `ensureDnsRecords.zones`; mini `catalog-sites.caddy`
        renders `https://openclaw.plato-splunk.media { reverse_proxy 127.0.0.1:18789 }`.
        **Deploy order: aedilis FIRST (DNS must resolve before mini's Caddy requests the cert
        via step-ca HTTP-01), then mini.**

## Open Questions — ALL RESOLVED (2026-11-05)

1. LLM provider → **OpenRouter API key** (sops `openrouter_api_key`).
2. Channels → **Control UI / WebChat only** initially.
3. Mail authority → **read + labeling**, granular env whitelists (`PROTON_MCP_OPERATIONS`,
   `PROTON_MCP_ALLOWED_LABELS`); no send/delete/trash.
4. Proton auth → **Bridge on mini** (approved).
5. Auto-login → **yes** (`system.defaults.loginwindow.autoLoginUser`; FileVault caveat in D2).
6. UI exposure → **tailnet vhost `openclaw.plato-splunk.media`** (jacob-chosen domain, phase 3)
   with Technitium provisioning via `catalogDns`.

Implementation-time unknowns (non-blocking): exact openclaw.json schema keys (verify vs bundled
docs), MCP protocol version OpenClaw's client negotiates, sops-nix darwin secret path/ownership
behavior (mini's first real consumer), Bridge supervision on a headless mini.

## References

- nixpkgs derivations (vendored): `repos/nixpkgs-unstable/pkgs/by-name/op/openclaw/package.nix`
  (v2026.10.3), `repos/nixpkgs-unstable/pkgs/by-name/mc/mcporter/package.nix` (v0.15.0),
  `repos/nixpkgs-26.05/.../openclaw/package.nix` (v2026.5.7 — stale).
- Upstream docs (fetched 2026-11-05): `docs/gateway/index.md`, `docs/gateway/configuration.md`,
  `docs/tools/mcp.md` (tag v2026.10.3), `docs/platforms/mac/bundled-gateway.md`.
- Kagi: `github.com/kagisearch/kagimcp`, `help.kagi.com/kagi/api/overview.html`.
- Vendored audit target: `repos/proton-mcp/` (upstream `37391294d62a4f76ee9e99849644682d0a9b08a4`).
- Repo patterns: `features/mini-jellyfin/*`, `docs/service-consolidation/mini.md`,
  `repos/nix-darwin/modules/launchd/default.nix` (`launchd.user.agents`),
  `repos/nix-darwin/modules/system/defaults/loginwindow.nix` (`autoLoginUser`),
  `service-registry.nix` (`catalogDns` → Technitium via `features/homelab-service/dns.nix` +
  `features/technitium-provisioning/`).
- Effect MCP (vendored v4.1.2 = this monorepo's pin): `repos/effect/packages/effect/src/ai/`
  (`McpServer.ts`, `Tool.ts`, `Toolkit.ts`, `McpProtocol.ts`), tests under
  `repos/effect/packages/effect/test/ai/McpServer/` (incl. `McpConformance/`), `NodeStdio` in
  `repos/effect/packages/platform/node/src/NodeStdio.ts`.
- Monorepo service/packaging patterns: `packages/homelab-server/src/main.ts` (layer composition),
  `nix-config/modules/features/homelab-api/package.nix` (fetchYarnBerryDeps + rolldown bundle +
  nodejs wrapper), `docs/nix-nodejs-services.md` (PnP sections stale — node-modules linker now).
