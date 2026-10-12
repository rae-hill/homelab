# Aedilis Implementation Audit

Status: **audit** — compares `docs/aedilis-host-plan.md` against the committed implementation.
Date: 2026-10-11

This document records gaps, discrepancies, and risks found when auditing the Technitium/aedilis
implementation against the plan. Items are prioritized: **[BLOCKER]** will prevent the host from
working, **[HIGH]** will cause a feature to silently fail, **[MED]** is a correctness/robustness
issue, **[LOW]** is cosmetic or doc drift.

---

## Summary

> **Remediation update (2026-10-11):** most findings below are now **FIXED**. #1 DoH collision
> resolved (DoH-over-HTTP relocated to loopback `dohBackendPort=8053`; Caddy owns 80). #2/#3/#5
> `provision.nix` was rewritten against the version-pinned APIDOCS with correct `api/admin/users/*`,
> `api/admin/groups/*`, `api/admin/permissions/*`, and `api/settings/set` keys, plus the full
> `2fa/init`→`2fa/enable` seed-capture flow and **fail-fast** error handling on every call. #9 and
> #10 fixed (doc drift corrected; `ssh-cert-renewer` enabled for aedilis). #4 (exact OIDC callback
> path) and #6 (empty-token-file hardening) remain to confirm at runtime — see
> `docs/aedilis-deployment-runbook.md`. #7 and #8 left open intentionally. The original analysis is
> preserved below for reference.

The structural implementation is complete and both `aedilis` and `augustus` evaluate. However, the
audit found **one blocker** (DoH port-80 collision), several **high** items concentrated in the
provisioning script (which uses unverified API shapes), and some doc drift. None of the high/med
items block evaluation; they will surface at runtime on the real box.

| #  | Severity | Area        | One-line                                                                     |
| -- | -------- | ----------- | ---------------------------------------------------------------------------- |
| 1  | BLOCKER  | DoH / Caddy | Technitium DoH-over-HTTP and Caddy both bind port 80                         |
| 2  | HIGH     | provision   | Technitium API paths/params in provision.nix are unverified guesses          |
| 3  | HIGH     | metrics     | DoT/DoQ `settings/set` keys are invented; likely wrong                       |
| 4  | HIGH     | OIDC        | OIDC callback `originUrl` is a placeholder, not Technitium's real path       |
| 5  | MED      | provision   | TOTP 2fa/enable flow is incomplete (needs init + verify step)                |
| 6  | MED      | metrics     | Prometheus `aedilis-dns` job depends on a token file that may not exist yet  |
| 7  | MED      | home        | No home-manager/nixvim config for the `admin` user                           |
| 8  | MED      | tailscale   | Port 5252 (TS metrics) is firewalled/scraped but never enabled on tailscaled |
| 9  | LOW      | docs        | Plan §2.3 still describes the old non-expiring `createToken` model           |
| 10 | LOW      | ssh         | `ssh-cert-renewer` imported but not enabled (no SSH host cert)               |

---

## 1. [BLOCKER] DoH-over-HTTP and Caddy both bind port 80

**Plan:** DoH = "Caddy terminates TLS → proxies to Technitium `:80` plaintext DoH" (§2.2).

**Implementation:**

- `technitium-service` sets `DNS_SERVER_OPTIONAL_PROTOCOL_DNS_OVER_HTTP = "true"`, which makes
  Technitium listen for plaintext DoH on **TCP 80**.
- `technitium-caddy` defines `http://${tech.domain}` and `http://${dnsMetrics.domain}` vhosts, so
  **Caddy also binds TCP 80** (for ACME challenge proxying + HTTPS redirect).
- The public DoH vhost does `reverse_proxy 127.0.0.1:80` — i.e. it proxies to port 80, which is
  Caddy itself, not Technitium.

**Problem:** Two services cannot both bind `0.0.0.0:80` / `127.0.0.1:80`. Technitium's DoH-over-HTTP
listener port is **not** exposed as an environment variable (the Docker env var list has no
`..._DNS_OVER_HTTP_PORT`), so it defaults to 80 and can only be changed in the web UI / via API.
Additionally, `reverse_proxy 127.0.0.1:80` is a self-loop, not a pointer to Technitium.

**Fix options:**

- (a) Set Technitium's DoH-over-HTTP port to a loopback port (e.g. 8053) via the provisioning
  oneshot (`api/settings/set`), bind Caddy's DoH `reverse_proxy` to that port, and keep Caddy on 80
  for ACME only. Requires confirming the exact settings key for the DoH-over-HTTP port.
- (b) Have Caddy terminate TLS and speak DoH directly to Technitium's **DNS** port using Caddy's
  DNS app — not supported by stock Caddy; rejected.
- (c) Move Caddy's ACME challenge off 80 (use the acme module's own listener on 80 and drop Caddy's
  `http://` vhosts), freeing 80 for Technitium DoH; then the public HTTPS DoH vhost proxies to
  `127.0.0.1:80`. This still collides because the acme module `listenHTTP` is on a loopback port,
  not 80 — but the public cert uses HTTP-01 which **needs** 80 publicly. Conflict persists.

**Recommended:** option (a). Pick a loopback DoH port, add it to `service-registry.nix`
(`tech.dohBackendPort = 8053`), set it during provisioning, and point the Caddy DoH vhost at it.
Keep port 80 owned by Caddy exclusively (ACME + redirect).

---

## 2. [HIGH] Provisioning script uses unverified Technitium API paths

**Plan:** §6 and the provisioning bullet explicitly flag these as "to verify during implementation."

**Implementation (`provision.nix`):** The script calls:

- `api/admin/users/list`, `api/admin/users/create`, `api/admin/users/set` — these endpoint paths and
  their parameters (`memberOfGroups`, `sessionTimeoutSeconds`) are **guesses** based on the APIDOCS
  structure, not verified against the actual API. The real Technitium API uses different routes
  (e.g. user/session management under `api/admin/sessions/*`, group/permission management under
  `api/admin/groups/*` and `api/admin/permissions/*`).
- Every call is `|| true` (failure-tolerant), so wrong paths will **silently no-op**, leaving the
  `prometheus` user uncreated and metrics auth broken — with no error surfaced.

**Risk:** Metrics scraping (`aedilis-dns` job) will fail auth because the limited user never gets
created, and the failure is swallowed.

**Fix:** Verify each endpoint against the running Technitium instance (or the version-matched
APIDOCS at the pinned `technitium-dns-server` version) and remove `|| true` from the user-creation
path so genuine failures are visible (keep tolerance only where idempotency genuinely requires it).

---

## 3. [HIGH] DoT/DoQ `settings/set` parameters are invented

**Implementation (`provision.nix` step 5):**

```
api/settings/set?enableDnsOverTls=true&enableDnsOverQuic=true&dnsTlsCertificatePath=...&dnsTlsCertificatePassword=...
```

These query-parameter names are **not** confirmed against the Technitium API. The real settings API
uses a large JSON/form body with specific field names (e.g. `dnsServerLocalEndPoints`,
`enableDnsOverTls`, `enableDnsOverQuic`, `dnsTlsCertificatePath`, `dnsTlsCertificatePassword` —
some of these may be correct, but the set call likely requires the full settings object, not a
partial update, and may reject unknown/partial params).

**Risk:** DoT (853/tcp) and DoQ (853/udp) silently never get enabled; the firewall opens 853 but
nothing listens.

**Fix:** Pull the current settings (`api/settings/get`), merge the TLS fields, and POST the full
object. Verify field names against the pinned version.

---

## 4. [HIGH] OIDC callback URL is a placeholder

**Implementation (`technitium-kanidm`):**

```nix
originUrl = "${tech.adminUrl}/";
```

with a comment admitting the real redirect path is unconfirmed. Kanidm validates the OAuth2
redirect URL strictly; if Technitium's actual callback is e.g.
`https://dns-admin.plato-splunk.media/api/user/sso/oauth2/callback`, then a bare `/` origin will
cause the OIDC flow to fail at the redirect step.

**Risk:** Admin-UI SSO login fails with a redirect-URI-mismatch error.

**Fix:** Determine Technitium's exact OIDC redirect path (from its SSO docs/UI) and set `originUrl`
to that exact URL. The `DNS_SERVER_SSO_AUTHORITY` issuer URL also needs cross-checking against what
Kanidm advertises (`.../oauth2/openid/technitium` vs the discovery URL).

---

## 5. [MED] TOTP enablement flow is incomplete

**Implementation (`provision.nix` step 4):** Calls only `api/user/2fa/enable?totp=<code>`. Per
APIDOCS, enabling 2FA is a two-step flow: `2fa/init` (returns a server-generated secret + QR) then
`2fa/enable` (confirms with a code derived from **that** secret). The script assumes the sops TOTP
seed is already the server's secret, which it is not unless `2fa/init`'s output was captured into
sops first.

**Risk:** TOTP never actually gets enabled; the augustus token oneshot then passes a `totp` the
server doesn't expect. If the user has no 2FA, the extra `totp` param is likely ignored (login still
works) — so this may degrade gracefully to password-only, silently dropping the intended hardening.

**Fix:** Either (a) implement the full init→enable capture and persist the server seed to sops, or
(b) drop TOTP from the automated path and document it as a manual hardening step. Decide explicitly;
don't leave it half-wired.

---

## 6. [MED] Prometheus `aedilis-dns` job references a token file that may not exist

**Implementation (`prometheus.nix`):** The `aedilis-dns` scrape job sets
`authorization.credentials_file = "/run/technitium-metrics/token"`. Prometheus fails a scrape config
load if the credentials file is missing at startup. The `technitium-metrics-token.service` is
ordered `before`/`wantedBy` prometheus, but if that oneshot fails (e.g. because the `prometheus`
user was never created — see #2), the file is absent and Prometheus may refuse to load the config or
mark the target down.

**Risk:** A failed token exchange could take down the whole Prometheus config reload, not just the
one job.

**Fix:** Have the token oneshot write a placeholder/empty token on failure (so the file always
exists), or make the job resilient. Verify Prometheus behavior when `credentials_file` is empty vs
missing. Consider `tmpfiles` pre-creating the file.

---

## 7. [MED] No home-manager / nixvim config for `admin`

**Plan:** Didn't explicitly require it, but every other Linux host has a
`home/jacob-<host>.nix` providing `homeConfigurations."jacob@<host>"` with `nixvim-complete`.

**Implementation:** aedilis imports `inputs.home-manager.nixosModules.home-manager` but defines no
`home-manager.users.admin` and there is no `home/admin-aedilis.nix`. So `admin` gets no nixvim, no
zsh/git home config.

**Risk:** Low functional impact (the DNS service doesn't need it), but inconsistent with the rest
of the fleet and the `admin` shell experience will be bare.

**Fix (optional):** Add `home/admin-aedilis.nix` mirroring `jacob-cicero.nix`, or add inline
`home-manager.users.admin` to the host. Defer if intentional.

---

## 8. [MED] Tailscale metrics (5252) opened + scraped but never enabled

**Observation (fleet-wide, not aedilis-specific):** All hosts firewall 5252 and Prometheus scrapes
`<host>:5252`, but no module runs `tailscale set --metrics` / configures the Tailscale client
metrics listener. aedilis faithfully copies this pattern (firewall + scrape target added), so it is
**consistent** with the fleet — but if the fleet's 5252 scrape is actually working, there must be
out-of-band config (manual `tailscale set`) not captured in Nix.

**Risk:** The `aedilis` entry in the `tailscale` Prometheus job will be DOWN unless TS metrics are
enabled on the box (same as the other hosts, presumably by manual `tailscale set`).

**Fix:** Out of scope for aedilis specifically; note that bringing TS metrics into Nix
(`extraSetFlags` with the metrics flag) would fix it fleet-wide.

---

## 9. [LOW] Plan §2.3 doc drift (old token model)

**Plan §2.3** still states the metrics token is "a non-expiring API token created via `POST
/api/user/createToken`." This contradicts the final design (expiring `login` token + TOTP + timer)
captured correctly in §6. Update §2.3 to reference the login-based flow for consistency.

---

## 10. [LOW] ssh-cert-renewer imported but not enabled

**Implementation:** `nixos.system-base` imports `ssh-cert-renewer`, but aedilis never sets
`services.ssh-cert-renewer.enable = true` (nor the required `serviceName`/`passwordFile`). So aedilis
has **no SSH host certificate** from step-ca — SSH relies on `TrustedUserCAKeys` for _user_ certs
only. cicero enables it; aedilis does not.

**Risk:** Low — user-cert SSH auth still works via `TrustedUserCAKeys`. Only matters if you want the
host to present a step-ca host certificate.

**Fix (optional):** If host certs are desired, enable `ssh-cert-renewer` with an aedilis service
account + sops password, matching cicero. Otherwise document as intentional.

---

## Additional observations (not gaps)

- **Firewall hardcoding:** `_private/aedilis/security.nix` hardcodes ports (53/80/443/853/8443/5252)
  rather than referencing `config.constants`, because the private host files are NixOS modules
  (no access to the flake-parts `constants`). This matches the cicero/praeconinus pattern and is
  correct — but if a port changes in `service-registry.nix`, the firewall must be updated manually.
  Consider a comment cross-linking the two.
- **`useInternalCA = true` on the metrics/admin vhosts:** harmless because every vhost sets `tls`
  explicitly, but it does make Caddy's _default_ issuer step-ca. Since no vhost relies on the
  default, there's no effect. Verified intentional.
- **PKCS#12 regeneration on renewal:** `provision.nix` is re-run via
  `acme-${tech.domain}.service.wants`, which refreshes the bundle on cert renewal — good. But the
  provision service is `RemainAfterExit = true` and `wants` (not `after`) ordering on renewal may
  race; confirm the renewal actually re-triggers a full ExecStart.
- **State-dir wipe caveat:** correctly documented — env-var bootstrap only applies on first boot.
  Operators must know that changing env config requires wiping `/var/lib/technitium-dns-server`.

---

## Recommended remediation order

1. **#1 (DoH port collision)** — blocks the headline DoH feature; fix before first deploy.
2. **#2, #3, #4** — verify the real Technitium API shapes on the running box; these gate metrics,
   DoT/DoQ, and SSO respectively. Best done interactively against the live instance.
3. **#5, #6** — harden the provisioning/token path once #2 is verified.
4. **#7, #9, #10** — cleanup/consistency; do opportunistically.
5. **#8** — fleet-wide, separate effort.

Items #2–#5 were all pre-flagged in the plan as "verify during implementation," so they are known
unknowns rather than surprises — but they remain **unresolved** in the committed code and will fail
silently (due to `|| true`) if not addressed.
