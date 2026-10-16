# Aedilis / Technitium — Security & Usability Audit

Status: **audit** — quick review of the implemented configurable Technitium module + aedilis layer.
Date: 2026-10-12

Scope: `features/technitium/*`, `features/technitium-provisioning/*`, `features/technitium-aedilis/*`,
`_private/aedilis/*`, and the augustus-side wiring. Severity: **[HIGH]** act before/at deploy,
**[MED]** worth doing soon, **[LOW]** nice-to-have / informational.

> **Provisioning update (2026-10-14):** provisioning was extracted into a separate
> `technitium-provisioning` feature and now authenticates as a **dedicated least-privilege
> `provisioner` user** (Settings:Modify + Zones:Modify) via a socket-activated token broker — **not**
> the built-in `admin`. This materially changes findings #5 and #10 below; see the inline updates.

---

## Summary table

| #  | Sev  | Area              | One-line                                                                         |
| -- | ---- | ----------------- | -------------------------------------------------------------------------------- |
| 1  | DONE | systemd hardening | ✅ added `SystemCallFilter`/`SystemCallArchitectures` on the DNS service         |
| 2  | DONE | DNS abuse         | ✅ QPM rate limiting — primary control for the open recursive resolver           |
| 3  | DONE | secrets           | ✅ dedicated `certGroup` for Caddy/Alloy; secrets are owner-only (no group)      |
| 4  | DONE | DNSSEC            | ✅ validation implemented; zone signing is a per-zone follow-up                  |
| 5  | MED  | provisioning      | Dedicated `provisioner` user (not admin); admin now disable-able post-setup      |
| 6  | DONE | metrics token     | ✅ token file pre-created + blanked on failure (no silent stale-token 401s)      |
| 7  | DONE | usability         | ✅ `provision.certReadyUnits` orders the encrypted-dns unit after the ACME unit  |
| 8  | LOW  | usability         | Admin UI cert is step-ca (browser trust needs root CA imported)                  |
| 9  | DONE | usability         | ✅ provisioning polls `/api/status` for readiness (replaced fixed sleep)         |
| 10 | DONE | hygiene           | ✅ `technitium_metrics_totp_secret` not in aedilis sops (captured manually)      |
| 11 | DONE | token broker      | ✅ socket root:tokenGroup 0660; cache 0700 broker-only; least-priv apiUser       |
| 12 | DONE | API cred exposure | ✅ token→Bearer header, pkcs12→env:; residual login/cert-pass query (local-only) |

---

## 1. [LOW] systemd hardening is retained — only `SystemCallFilter` missing

**Verified (not a problem):** the upstream unit sets its `Protect*`/`Restrict*` directives
**unconditionally** (siblings of `DynamicUser`, not gated on it). Our module overrides only
`DynamicUser`, `User`, `Group`, `StateDirectory`, and the capability sets, so NixOS **merges** and
**keeps** the upstream sandbox. Confirmed by evaluating the effective `serviceConfig`:
`ProtectSystem=strict`, `ProtectHome=true`, `NoNewPrivileges=true`, `RestrictAddressFamilies`,
`PrivateDevices=true`, `RestrictNamespaces=true`, `ProtectKernelModules=true` are all present with
the static user.

The only hardening neither upstream nor we set is **`SystemCallFilter`**. Optional improvement for a
public-facing daemon:

```nix
systemd.services.technitium-dns-server.serviceConfig = {
  SystemCallFilter = [ "@system-service" "~@privileged" "~@resources" ];
  SystemCallArchitectures = "native";
};
```

Run `systemd-analyze security technitium-dns-server` to gauge the score before/after. Low priority
since the rest of the sandbox is intact.

---

## 2. [HIGH → IMPLEMENTED] Per-client rate limiting — now the primary open-resolver control

> **Role update (2026-10-13):** aedilis is now a recursive resolver with recursion open to any
> client (`DNS_SERVER_RECURSION=Allow`) and public plaintext 53 **firewalled off** (reachable only
> over Tailscale). Rate limiting is therefore the **primary** abuse control for the open resolver —
> not just a reflection blunting on an authoritative server. It remains enabled and applies to the
> public encrypted transports (DoH/DoT/DoQ) and the Tailscale-only plain 53.

**Implemented (2026-10-12).** Added a `rateLimit` option group
(`services.technitium-server-complete.rateLimit.{enable,sampleMinutes,udpTruncationPercentage,ipv4,ipv6}`)
and wired it into the provisioner's `settings/set` (`qpmLimitSampleMinutes`,
`qpmLimitUdpTruncationPercentage`, `qpmPrefixLimitsIPv4/IPv6`). aedilis enables it with per-/32 (v4)
and per-/64 (v6) UDP caps and 50% TC-truncation fallback, so over-limit UDP clients get a TCP retry
rather than being dropped — bounding DoS/abuse of the open resolver without hurting legitimate
clients.

Original finding retained for context:

> Recursion is correctly ACL-restricted (anti-amplification's primary control). But an open
> **authoritative** server on UDP/53 can still be used as a modest reflection amplifier.

---

## 3. [LOW] Secret group ownership is set but mode is owner-only (OK, but tidy up)

All technitium sops secrets are `owner = technitium; group = technitium`, and Caddy is a **member of
the `technitium` group** (for cert read access). At first glance that looks like Caddy could read the
admin/OIDC/PKCS#12/metrics secrets.

**Verified it cannot:** sops-nix renders these secrets with **mode `0400`** (owner-only), so the
group bit grants nothing — only the `technitium` _user_ reads them. Caddy (group member, not owner)
is denied by the file mode. So this is **not** an exposure today.

**Tidy-up (defense-in-depth):** the group-ownership on the secrets is doing nothing useful and is
misleading. Two cleaner options:

- Drop `group = technitium` from the sops secrets (leave owner-only), since the service reads them as
  the `technitium` user anyway; or
- If you ever need group-readable secrets, use a dedicated group — don't reuse the one Caddy joins.

Caddy's cert access is independent: ACME certs live under `/var/lib/acme/<domain>` owned by each
cert's `group` (currently `technitium`), which is the actual reason Caddy is in the group. Consider a
dedicated `technitium-certs` group for the ACME certs so Caddy's membership is scoped to certs only.

---

## 4. [MED → PARTIALLY IMPLEMENTED] DNSSEC posture

**Validation side — implemented (2026-10-12).** Added a `dnssecValidation` option (default `true`)
wired into the provisioner (`settings/set?dnssecValidation=`). aedilis enables it, so recursive
answers served to clients are DNSSEC-validated against forged/poisoned upstream responses.

**Signing side — not applicable to aedilis (recursive resolver).** aedilis no longer hosts
authoritative zones, so DNSSEC _signing_ (sign zone → publish `DS` → key rollovers) is out of scope
here; it belongs on the dedicated authoritative hosts. Only validation (above) applies to aedilis.

---

## 5. [MED] Admin password lifecycle

> **Update (2026-10-14): provisioning no longer uses `admin`.** The provisioner now authenticates
> as a dedicated least-privilege `provisioner` user (sops `technitium_provisioner_password`) via the
> token broker. The built-in `admin` is now needed **only** for (1) first-boot bootstrap
> (`DNS_SERVER_ADMIN_PASSWORD_FILE`) and (2) the one-time **manual** creation of the `provisioner`
> and `prometheus` users (runbook step 6a). Consequently the earlier footgun — "auto-disabling admin
> breaks provisioning because the provisioner logs in as admin" — **no longer applies**: the local
> `admin` CAN be disabled after setup for a true OIDC-only posture **without breaking** settings /
> records / token-refresh (all of which run as `provisioner`). Re-enable admin only for break-glass.
> This arguably lowers the severity of this finding.

`DNS_SERVER_ADMIN_PASSWORD_FILE` only applies on **first boot**. Observations:

- There is a window on first boot where the built-in `admin` account exists with the provided
  password before OIDC is usable — fine, but the admin password then lives indefinitely as a
  fallback local account (OIDC bypass). If the sops value leaks, local admin login over the
  Tailscale-only UI is possible.
- No rotation path: changing the sops value post-first-boot does nothing (state dir already exists).

**Fix options:** (a) after OIDC is confirmed working **and** the `provisioner`/`prometheus` users
have been created (step 6a), disable the local `admin` account **manually** — this is now safe
because provisioning runs as `provisioner`, not `admin`. (b) Keep the admin password a long random
sops value, never used interactively, treated as break-glass. At minimum, document that the local
admin is a break-glass account and keep its sops secret high-value.

> **Note on "avoid the password entirely":** not possible — Technitium always has a built-in local
> `admin`, and bootstrapping/break-glass needs a credential. But the _provisioner_ credential is now
> a **separate, least-privilege** `provisioner` password served via an on-demand token broker over a
> group-locked socket — not the admin password, and not a non-expiring API token (which would be a
> long-lived bearer on disk). The admin sops password is used only at first-boot + for the one-time
> manual user creation + as break-glass. For OIDC-only interactive login, disable the local admin
> post-setup and re-enable via API for break-glass.

---

## 6. [MED] Metrics token file hardening on augustus

The augustus `technitium-metrics-token` oneshot writes `/run/technitium-metrics/token`. Confirm:

- The tmpfiles rule creates `/run/technitium-metrics` `0750 prometheus prometheus` (it does), and
  the token file is written `0640`/`0600` owned by `prometheus` (the script uses `umask 027`).
- Prometheus reads it via `authorization.credentials_file`. If the oneshot fails, the file may be
  **stale** (an expired token) rather than absent — Prometheus would then get 401s silently. A short
  freshness check (or writing an empty file on failure) would make failures louder. Low-ish, but
  worth a guard.

---

## 7. [LOW] Generic provision ↔ ACME ordering

The generic `provision.nix` orders only `after/requires technitium-dns-server.service`. The
dependency on the **public ACME cert** (needed for the PKCS#12 conversion) is only expressed in the
aedilis ACME layer via the cert's `reloadServices`/the service `after`. For a clean generic module,
consider an option like `provision.certReadyUnit` so the oneshot can `after`/`wants` the right ACME
unit without the aedilis layer having to reach in. Currently relies on `Restart=on-failure` to paper
over a race. Works, but noisy on first boot.

---

## 8. [LOW] Admin UI uses a step-ca cert (browser trust)

The admin UI vhost (`:8443`) uses the internal step-ca cert. Browsers will warn unless the Alford
root CA is imported into the client's trust store. That's consistent with the rest of the homelab,
but note it in the runbook so you aren't surprised by a cert warning (vs. the public DNS cert which
is Let's Encrypt and publicly trusted).

---

## 9. [LOW] No readiness/health probe

Nothing wires Technitium's health-check API (`/api/dnsClient/healthCheck`) or a systemd readiness
notification. The provision oneshot `sleep 10` + `Restart=on-failure` is a heuristic. A small
`ExecStartPre`/`curl` readiness loop in the provisioner (poll `/api/status` until ok) would be more
robust than a fixed sleep and would make the first-boot ordering deterministic.

---

## 10. [DONE] Unused aedilis sops secret

The `prometheus` metrics user is created **manually** (runbook step 6a), and its TOTP seed is
captured at `2fa/enable` time and transferred to augustus **out-of-band** — it is **not** stored in
aedilis sops (and there is no server-generated seed state file). So `technitium_metrics_totp_secret`
belongs only on augustus (which computes scrape login codes), not on aedilis.

**Status: done.** `technitium_metrics_totp_secret` is **not** declared in
`_private/aedilis/sops.nix`; it lives only in `augustus.yaml`. Consider removing it from
`secrets/aedilis.yaml` on the next re-key if any stale value remains there.

> The earlier rationale in this finding ("TOTP seed is server-generated on aedilis / persisted to a
> state file") was never implemented and is obsolete — the seed is a manual-capture step, not a
> provisioner-written state file.

---

## 11. [DONE] Token broker — secret-at-rest & socket lockdown (new, 2026-10-14)

The socket-activated token broker (`features/technitium-provisioning/token.nix`) was reviewed:

- **Socket lockdown:** `technitium-provision-token.socket` is `root:<tokenGroup>` mode `0660`
  (`SocketMode = "0660"`, `SocketGroup = provision.tokenGroup`). Only members of the dedicated
  `tokenGroup` can connect; consumers join it via `SupplementaryGroups`. ✅
- **Credential isolation:** only the broker service user reads `apiPasswordFile`; the token cache is
  a `StateDirectory` mode `0700` (broker-user-only, never group-exposed). Consumers receive only the
  session token over the socket — never the password or the cache. ✅
- **Least privilege:** the broker logs in as the dedicated `provisioner` user
  (`Settings:Modify` + `Zones:Modify`, no `Administration`), so a leak of the broker credential
  cannot create users or escalate. ✅
- **Concurrency:** refresh is `flock`-guarded, so concurrent connections can't race the cache or
  double-mint. ✅
- **Lazy refresh:** no long-lived timer; the token refreshes on-connect once `tokenTtlSeconds`
  elapses, bounding the on-disk token's validity window. ✅

No action required.

---

## 12. [DONE/LOW] API credential exposure on process argv / query strings (new, 2026-10-14)

Reviewed how the provisioning scripts pass secrets to the loopback Technitium API:

- **Session token — hardened.** `api_call` (shared `preamble` in `lib.nix`) now authenticates with
  the `Authorization: Bearer <token>` header fed via curl `--config` on stdin, so the token appears
  neither on the process argv (`ps`/`/proc`) nor in Technitium's query-string access logs. (Was
  previously a `token=` query param.) ✅
- **PKCS#12 export password — hardened.** `encrypted-dns.nix` now passes the password to `openssl`
  via `-passout env:PKCS12_PASS` instead of `pass:` on argv, keeping it off the process listing. ✅
- **Residual [LOW], accepted:** two secrets still transit as `--data-urlencode` query params because
  the Technitium API has no header-based alternative for them: the `provisioner` password on the
  `user/login` call (`token.nix`) and `dnsTlsCertificatePassword` on the `settings/set` call
  (`encrypted-dns.nix`). Both are momentarily visible on the local curl argv and may be written to
  Technitium's web access log as query params. Exposure is **local-only** (loopback API, single-tenant
  Tailscale-gated host) and short-lived. Mitigations if ever desired: route these specific calls
  through curl `--config` stdin as well, and/or disable/scrub Technitium web request logging. Left as
  a low-priority accepted risk given the single-tenant, loopback, Tailscale-only threat model.

---

## Positive notes (things that are good)

- **Recursion open** to any client (`DNS_SERVER_RECURSION=Allow`) — personal recursive resolver.
  Abuse is bounded by per-client QPM rate limiting + public plaintext 53 being firewalled off
  (reachable only over Tailscale); public recursion is served only over non-spoofable encrypted
  transports (DoH/DoT/DoQ).
- **mTLS kept where it belongs** (metrics, which has no OIDC) and dropped where redundant (admin UI
  behind Tailscale + OIDC). Good least-surprise.
- **Fail-fast provisioning** with per-call status/errorMessage checks — failures are visible.
- **Expiring login tokens** for metrics (not non-expiring API tokens) + TOTP — strong metrics-auth.
- **Secrets by file path**, never inlined; **cert inputs decoupled** from the provisioner.
- **Firewall** is explicit and interface-scoped (public DNS vs Tailscale-only admin/metrics/SSH).

---

## Recommended action order

All items except #5 and #8 are now implemented (2026-10-12):

- ✅ #1 `SystemCallFilter`; ✅ #2 QPM rate limiting; ✅ #3 dedicated `certGroup` + owner-only secrets;
  ✅ #4 DNSSEC validation; ✅ #6 token file pre-create + blank-on-failure; ✅ #7 `certReadyUnits`
  ordering; ✅ #9 readiness poll; ✅ #10 unused sops secret removed.
- **#5 (admin break-glass)** — a posture _decision_ for you to make at/after deploy (disable the
  local admin manually once OIDC is verified). Not a code change.
- **#8 (admin UI step-ca cert)** — informational; import the Alford root CA into your browser trust.
  Documented in the runbook.
