# Aedilis / Technitium — Security & Usability Audit

Status: **audit** — quick review of the implemented configurable Technitium module + aedilis layer.
Date: 2026-10-12

Scope: `features/technitium/*`, `features/technitium-aedilis/*`, `_private/aedilis/*`, and the
augustus-side wiring. Severity: **[HIGH]** act before/at deploy, **[MED]** worth doing soon,
**[LOW]** nice-to-have / informational.

---

## Summary table

| #  | Sev  | Area              | One-line                                                                     |
| -- | ---- | ----------------- | ---------------------------------------------------------------------------- |
| 1  | DONE | systemd hardening | ✅ added `SystemCallFilter`/`SystemCallArchitectures` on the DNS service     |
| 2  | DONE | DNS abuse         | ✅ QPM rate limiting on public UDP/53 implemented                            |
| 3  | DONE | secrets           | ✅ dedicated `certGroup` for Caddy/Alloy; secrets are owner-only (no group)  |
| 4  | DONE | DNSSEC            | ✅ validation implemented; zone signing is a per-zone follow-up              |
| 5  | MED  | provisioning      | Admin password only set first-boot; break-glass local admin (manual disable) |
| 6  | DONE | metrics token     | ✅ token file pre-created + blanked on failure (no silent stale-token 401s)  |
| 7  | DONE | usability         | ✅ `provision.certReadyUnits` option orders the oneshot after the ACME unit  |
| 8  | LOW  | usability         | Admin UI cert is step-ca (browser trust needs root CA imported)              |
| 9  | DONE | usability         | ✅ provisioner polls `/api/status` for readiness (replaced fixed sleep)      |
| 10 | DONE | hygiene           | ✅ removed unused `technitium_metrics_totp_secret` from aedilis sops         |

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

## 2. [HIGH → IMPLEMENTED] Per-client rate limiting on public UDP/53

**Implemented (2026-10-12).** Added a `rateLimit` option group
(`services.technitium-server-complete.rateLimit.{enable,sampleMinutes,udpTruncationPercentage,ipv4,ipv6}`)
and wired it into the provisioner's `settings/set` (`qpmLimitSampleMinutes`,
`qpmLimitUdpTruncationPercentage`, `qpmPrefixLimitsIPv4/IPv6`). aedilis enables it with per-/32 (v4)
and per-/64 (v6) UDP caps and 50% TC-truncation fallback, so over-limit UDP clients get a TCP retry
rather than being dropped — blunting reflection/amplification without hurting legitimate clients.

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
answers served to trusted Tailscale clients are DNSSEC-validated against forged/poisoned upstream
responses.

**Signing side — still a per-zone decision.** For zones aedilis is _authoritative_ for, DNSSEC
signing (sign zone → publish `DS` at the registrar → manage key rollovers) is done per-zone in the
UI/API when zones are created. Not a global toggle; defer to the zones/HA follow-up. Documented so
it isn't forgotten.

---

## 5. [MED] Admin password lifecycle

`DNS_SERVER_ADMIN_PASSWORD_FILE` only applies on **first boot**. Observations:

- There is a window on first boot where the built-in `admin` account exists with the provided
  password before OIDC is usable — fine, but the admin password then lives indefinitely as a
  fallback local account (OIDC bypass). If the sops value leaks, local admin login over the
  Tailscale-only UI is possible.
- No rotation path: changing the sops value post-first-boot does nothing (state dir already exists).

**Fix options:** (a) after OIDC is confirmed working, disable the local `admin` account **manually**
(or via a one-off break-glass procedure) — NOT via the provisioner, since the provisioner itself
authenticates as `admin` on every run (cert renewals re-trigger it), so auto-disabling admin would
break subsequent provisioning runs (a footgun we deliberately avoided). (b) Keep the admin password
a long random sops value, never used interactively, treated as break-glass. At minimum, document
that the local admin is a break-glass account and keep its sops secret high-value.

> **Note on "avoid the password entirely":** not possible — Technitium always has a built-in local
> `admin`, and the provisioner needs a credential to drive the API. A non-expiring API token would
> be strictly worse (long-lived bearer on disk). The sops admin password, used only at provision
> time + as break-glass, is the right tradeoff. If you want OIDC-only interactive login, disable the
> local admin manually post-deploy and re-enable via API for break-glass.

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

## 10. [LOW] Unused aedilis sops secret

Since the TOTP seed is now **server-generated** on aedilis (persisted to a state file), the
`technitium_metrics_totp_secret` sops secret declared in `_private/aedilis/sops.nix` is **no longer
consumed on aedilis** (only augustus consumes it). Leaving it is harmless but misleading.

**Fix:** remove `technitium_metrics_totp_secret` from `_private/aedilis/sops.nix` (keep it in
`augustus.yaml`). Also consider removing it from `secrets/aedilis.yaml` on the next re-key.

---

## Positive notes (things that are good)

- **Recursion ACL** restricted to Tailscale CGNAT + ULA + loopback — correct anti-amplification model.
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
