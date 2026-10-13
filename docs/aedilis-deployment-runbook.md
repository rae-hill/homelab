# Aedilis Deployment Runbook

Status: **runbook** — step-by-step first deployment of the `aedilis` Technitium DNS host.
Date: 2026-10-13 (updated for the recursive-resolver role change:
`DNS_SERVER_RECURSION=Allow`, public plaintext 53 firewalled off — Tailscale-only, public recursion
served only over DoH/DoT/DoQ. Prior refactor: `services.technitium-server-complete`, native
DoH/DoT/DoQ, admin UI on `:8443` OIDC-only, metrics on `:9443` mTLS.)

This runbook covers the full bring-up sequence for `aedilis`, an OVHCloud VPS running Technitium
DNS as a personal **recursive resolver**. It accounts for the bootstrapping ordering problem:
**aedilis cannot reach Kanidm or step-ca over Tailscale until it has joined the tailnet and been
added to the Tailscale ACLs, which happens _after_ the initial deploy.** The runbook is therefore
staged so that each service comes up (or retries) in the right order.

> Related docs: `docs/aedilis-host-plan.md` (design), `docs/aedilis-implementation-audit.md` (gaps).

---

## 0. Prerequisites (on your workstation)

- The repo checked out, with `nix` + the devshell available (`nix develop`).
- Your YubiKey `yk1` plugged in (the `yk1-ssh-ed25519` key authorizes `root`/`admin` on aedilis via
  the base-image `authorizedKeys`).
- The OVH VPS reachable by its **public IP / provisioning hostname** (e.g. `vps-fd52f045.vps.ovh.us`)
  — SSH is only firewalled to `tailscale0` in the final config, but on the stock OVH image (before
  the first switch) SSH is still open on the public interface.
- `secrets/aedilis.yaml` committed and encrypted to **both** your personal age key and the aedilis
  host age key (see `.sops.yaml`). Required: `technitium_admin_password`,
  `technitium_sso_client_secret`, `technitium_pkcs12_password`, `technitium_metrics_user_password`,
  and `step_jwk_provisioner_password`. (The metrics **TOTP seed** is server-generated on aedilis
  during provisioning — not pre-seeded here.)
- On **augustus**, `secrets/augustus.yaml` must contain `technitium_client_secret`,
  `technitium_metrics_user_password`, and `technitium_metrics_totp_secret`. The TOTP secret value is
  **not known yet** — it is generated on aedilis during provisioning (step 6). Seed it with a
  placeholder for now and update it later.

### Secret value coordination (must match across hosts)

| Secret                | aedilis key                        | augustus key                       | When set                                |
| --------------------- | ---------------------------------- | ---------------------------------- | --------------------------------------- |
| OIDC client secret    | `technitium_sso_client_secret`     | `technitium_client_secret`         | Now (generate once, put in both)        |
| Metrics user password | `technitium_metrics_user_password` | `technitium_metrics_user_password` | Now (same value both)                   |
| Metrics TOTP seed     | `technitium_metrics_totp_secret`   | `technitium_metrics_totp_secret`   | **After step 6** (generated on aedilis) |

---

## 1. Pre-flight validation (workstation)

```sh
# Evaluate the host builds before touching the box.
nix eval .#nixosConfigurations.aedilis.config.system.build.toplevel.drvPath

# Confirm augustus still evaluates (Kanidm/Prometheus changes).
nix eval .#nixosConfigurations.augustus.config.system.build.toplevel.drvPath
```

Both must succeed. (augustus `toplevel` requires a clean git tree because of the homelab-api commit
guard — commit first, or eval a sub-attribute to spot-check.)

---

## 2. Deploy augustus FIRST (OIDC client + Prometheus wiring)

The Kanidm OIDC client `technitium` and the Prometheus scrape/token-exchange live on augustus.
Deploy augustus so the OIDC client exists before aedilis tries to use SSO.

```sh
# From the devshell:
remote-build-augustus    # nixos-rebuild switch --target-host jacob@augustus...
```

Verify on augustus:

```sh
ssh jacob@augustus.plato-splunk.media
systemctl status kanidm                 # provisioning applied the technitium oauth2 client
sudo journalctl -u kanidm | grep -i technitium
```

> The augustus `technitium-metrics-token.timer` will start failing to reach aedilis until aedilis is
> up and on the tailnet — that is expected at this stage.

---

## 3. Initial deploy to aedilis over SSH (root + yk1)

The box is still on (or freshly switched from) the OVH stock image. Deploy the flake config using
`nixos-rebuild` targeting **root** with the `yk1` key.

```sh
# Ensure the yk1 key is the one offered. Either rely on your SSH agent, or be explicit:
ssh-add -L | grep yk1   # confirm yk1 is loaded in the agent

# First switch. Target the public/provisioning hostname (NOT the tailnet name — not joined yet).
nixos-rebuild switch \
  --flake .#aedilis \
  --target-host root@vps-fd52f045.vps.ovh.us \
  --build-host localhost
```

Notes:

- Use `root@` for the very first switch: the stock OVH image authorizes the yk1 key for `root`, and
  our config's `admin` user may not yet have its home/SSH set up on the first push.
- `--build-host localhost` builds on your workstation (the VPS is small). Drop it to build on the
  box if preferred.
- If `nixos-rebuild` cannot find the host key / prompts about host authenticity, accept it (the box
  identity changes when the SSH host key is regenerated by the new config).

### If the first switch fails to connect

- Confirm SSH reachability: `ssh -i ~/.ssh/yk1 root@vps-fd52f045.vps.ovh.us`.
- The stock image may use password or a different key — use whatever the OVH image was provisioned
  with for the FIRST push, then subsequent pushes use the config's keys.

---

## 4. Post-switch sanity (before Tailscale)

SSH into the box (still via public IP, as `admin` now):

```sh
ssh admin@vps-fd52f045.vps.ovh.us

# System came up?
systemctl is-system-running          # may be "degraded" — expected (see below)
systemctl --failed                   # list failed units

# sops decrypted? (needs the host age key present at /home/admin/.config/sops/age/keys.txt)
sudo systemctl status sops-nix
ls -l /run/secrets/                  # should list the technitium_* secrets
```

**Expected failures at this stage** (because the tailnet/ACLs aren't set up yet):

- `acme-dns.plato-splunk.media` — Let's Encrypt HTTP-01 needs public port 80 reachable; should
  actually SUCCEED here if the OVH firewall allows 80 inbound. If it fails, check port 80.
- `acme-dns-admin.plato-splunk.media` and `acme-dns-metrics.plato-splunk.media` — step-ca certs,
  need step-ca over Tailscale → **will fail** until steps 5+6.
- `technitium-provision` — needs the public ACME cert for the DoH/DoT/DoQ PKCS#12; retries
  (`Restart=on-failure`).
- `alloy` — needs the dns-metrics cert → will fail until step 6.
- `ssh-cert-renewer` — needs step-ca over Tailscale → will fail until step 6 (daily timer retries).

The core `technitium-dns-server` should be **running** (it does not depend on the certs to start;
plain DNS on 53 is bound immediately, encrypted transports come online after provisioning):

```sh
systemctl status technitium-dns-server
sudo journalctl -u technitium-dns-server --no-pager | tail -50
# Recursion is open, so a local query should resolve recursively straight away:
dig @127.0.0.1 example.com      # should return an answer (recursive resolve)
```

---

## 5. Join the tailnet

```sh
# On aedilis:
sudo tailscale up --ssh --hostname aedilis
# Follow the auth URL it prints; authenticate in your browser.
tailscale status
tailscale ip -4            # note the 100.x address
```

Confirm the hostname registers as `aedilis` in your tailnet admin console. The firewall allows
SSH/admin/metrics only on `tailscale0`, so from here on prefer the tailnet name
`aedilis.<your-tailnet>.ts.net` / `aedilis.plato-splunk.media`.

---

## 6. Add aedilis to Tailscale ACLs (grant Kanidm + step-ca access)

In the Tailscale admin console (ACL editor), grant `aedilis` access to:

- **step-ca** on cicero (ACME for the dns-admin + dns-metrics certs + ssh host cert renewal).
- **Kanidm** (`idm.plato-splunk.media`) for OIDC discovery/token (admin-UI SSO).
- **augustus Loki push** endpoint (Alloy log shipping) and the metrics scrape path (augustus →
  aedilis `dns-metrics:9443`).

Example ACL grant (adapt to your policy syntax):

```jsonc
{
  "src": ["tag:aedilis"],            // or the aedilis node
  "dst": [
    "cicero:443",                    // step-ca
    "idm.plato-splunk.media:443",    // kanidm
    "augustus:*"                     // loki-push + general
  ]
}
// And allow augustus -> aedilis for the metrics scrape + admin UI + TS metrics:
{
  "src": ["augustus"],
  "dst": ["aedilis:9443", "aedilis:5252"]
}
// Allow your workstation/devices to reach the admin UI over Tailscale:
{
  "src": ["autogroup:member"],
  "dst": ["aedilis:8443"]
}
```

After saving the ACLs, trigger the dependent units on aedilis:

```sh
# On aedilis — force the internal certs + provisioning now that step-ca is reachable:
sudo systemctl start acme-dns-admin.plato-splunk.media.service
sudo systemctl start acme-dns-metrics.plato-splunk.media.service
sudo systemctl status acme-dns-metrics.plato-splunk.media.service

sudo systemctl start technitium-provision.service
sudo journalctl -u technitium-provision --no-pager    # watch for "completed successfully"

sudo systemctl start alloy.service
sudo systemctl status alloy.service

sudo systemctl start ssh-cert-renewer.service
sudo journalctl -u ssh-cert-renewer --no-pager
```

> `technitium-provision` will print an **ACTION REQUIRED** line with the server-generated TOTP seed
> written to `/var/lib/technitium-dns-server/metrics-totp-seed`. Capture it in the next step.

### SSH host cert renewal note

`ssh-cert-renewer` needs the step-ca JWK provisioner **private key** on the box at the step path
(`$(step path)/step-jwk-priv.json`). If you have not provisioned it, place it now (out-of-band copy)
and re-run the service. Until the host cert is issued, you authenticate with your user cert /
authorized key as normal.

---

## 7. Transfer the TOTP seed to augustus

The metrics `prometheus` user's TOTP seed is generated on aedilis (server-side) during provisioning.
augustus needs the same seed to compute login codes for the metrics scrape.

```sh
# On aedilis — read the seed (technitium-owned, root can read):
sudo cat /var/lib/technitium-dns-server/metrics-totp-seed ; echo

# On your workstation — put it into augustus sops:
sops nix-config/secrets/augustus.yaml
#   set:  technitium_metrics_totp_secret: "<seed from above>"
#   also confirm technitium_metrics_user_password matches aedilis's value.

# Commit and redeploy augustus so the token oneshot can authenticate:
git add nix-config/secrets/augustus.yaml && git commit -m "aedilis: add technitium metrics TOTP seed"
remote-build-augustus
```

Then on augustus:

```sh
ssh jacob@augustus.plato-splunk.media
sudo systemctl start technitium-metrics-token.service
sudo journalctl -u technitium-metrics-token --no-pager   # should write /run/technitium-metrics/token
cat /run/technitium-metrics/token >/dev/null && echo "token present"
sudo systemctl reload prometheus || sudo systemctl restart prometheus
```

---

## 8. End-to-end verification

### DNS (recursive resolver)

```sh
# Public plaintext 53 is FIREWALLED OFF — this should TIME OUT from off-network:
dig @aedilis-public-ip google.com               # expect timeout (port 53 closed publicly)

# Public recursion works over the encrypted transports (open to any client):
# DoT (Technitium-native TLS on 853/tcp):
kdig -d @aedilis-public-ip +tls google.com      # should resolve recursively
# DoH (Technitium-native TLS on 443):
curl -s "https://dns.plato-splunk.media/dns-query?name=google.com&type=A" \
  -H 'accept: application/dns-json'              # should resolve recursively
# DoQ (if your client supports it): 853/udp

# Plain DNS over Tailscale (personal devices) should resolve recursively:
dig @aedilis.plato-splunk.media google.com      # over the tailnet; should resolve
```

### Admin UI (Tailscale + OIDC, no mTLS)

- Browse to `https://dns-admin.plato-splunk.media:8443` **over Tailscale**. No client cert is
  required (Tailscale network + OIDC are the gates). You should be redirected to Kanidm SSO.
- Verify SSO: the `technitium.admins` Kanidm group maps to Technitium `Administrators`.

### Metrics (from augustus)

```sh
# On augustus:
curl -s --cacert <root-ca> \
  --cert <prometheus-client-cert> --key <prometheus-client-key> \
  -H "Authorization: Bearer $(cat /run/technitium-metrics/token)" \
  https://dns-metrics.plato-splunk.media:9443/api/dashboard/metrics/text | head
# Node exporter via the same mTLS vhost:
curl -s --cacert ... --cert ... --key ... https://dns-metrics.plato-splunk.media:9443/metrics | head
```

In Grafana/Prometheus, confirm the `aedilis-node`, `aedilis-dns`, and `tailscale{instance=aedilis}`
targets are **UP**.

### Logs

- In Grafana (Loki), filter `{hostname="aedilis"}` — Alloy should be shipping journald.

---

## 9. Debugging cheatsheet

| Symptom                                    | Check                                                                                                                                                                                  |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `technitium-provision` keeps restarting    | `journalctl -u technitium-provision` — it fails fast with the Technitium `errorMessage`. Common causes: admin password mismatch (sops), public ACME cert not yet present.              |
| Public cert won't issue                    | `journalctl -u acme-dns.plato-splunk.media` — ensure OVH security group allows inbound 80; Caddy's `:80` vhost proxies `/.well-known/acme-challenge` to the acme listener.             |
| Admin/metrics cert won't issue             | step-ca unreachable → verify Tailscale ACLs (step 6); `journalctl -u acme-dns-admin.plato-splunk.media` / `acme-dns-metrics...`.                                                       |
| DoH/DoT/DoQ not listening (443/853)        | `technitium-provision` `settings/set` failed → check provision logs; confirm the PKCS#12 exists at `/var/lib/technitium-dns-server/dns.pfx` and the public cert is present.            |
| Public plain DNS (53) times out            | **By design.** Port 53 is firewalled off the public internet (Tailscale-only). Public clients must use DoH/DoT/DoQ. Do NOT reopen 53 publicly — see `docs/aedilis-host-plan.md` §7a.   |
| Recursion refused for a client             | Recursion is `Allow` (open to all). If a client is refused, check per-client QPM rate limits (`settings/get`) — a client exceeding the cap gets throttled/truncated, not a config ACL. |
| Admin UI unreachable                       | It's bound to `tailscale0:8443` — must be reached over Tailscale. Confirm the Tailscale ACL allows your device → `aedilis:8443`.                                                       |
| Admin SSO redirect error                   | OIDC `originUrl` in the Kanidm client must match Technitium's real callback. Check `journalctl -u kanidm` on augustus and Technitium web logs.                                         |
| Metrics scrape 401/invalid-token           | augustus token oneshot failed → `journalctl -u technitium-metrics-token`; verify TOTP seed + password match between hosts; re-run the service.                                         |
| Prometheus won't load config               | `/run/technitium-metrics/token` missing → start `technitium-metrics-token.service` before prometheus.                                                                                  |
| SSH host cert missing                      | `journalctl -u ssh-cert-renewer` — needs step-ca over Tailscale + the JWK provisioner key on the box.                                                                                  |
| sops secrets absent (`/run/secrets` empty) | aedilis host age key not a recipient, or `/home/admin/.config/sops/age/keys.txt` missing → `journalctl -u sops-nix`.                                                                   |

### Useful one-liners (on aedilis)

```sh
systemctl --failed
sudo journalctl -u technitium-dns-server -u technitium-provision -u caddy -u alloy --since "10 min ago"
# Who is listening where. NOTE: 53 WILL appear bound (Technitium always binds it);
# it is firewalled off the public internet and reachable only over tailscale0.
sudo ss -tlnp | grep -E ':(53|80|443|853|5380|8443|9443|9100)'
# Confirm the public firewall drops 53 but allows the encrypted transports:
sudo iptables -S | grep -E 'dpt:(53|443|853)' ; sudo ip6tables -S | grep -E 'dpt:(53|443|853)'
sudo tailscale status
```

---

## 10. Post-deploy follow-ups

- Re-run full validation and commit the TOTP seed change.
- Confirm the `technitium-metrics-token.timer` is active (`systemctl list-timers | grep technitium`).
- Confirm recursion works for your own devices over the encrypted transports and over Tailscale
  plain DNS; set your clients' DNS to aedilis (DoH/DoT) as desired. Authoritative zones and HA are
  handled on separate dedicated hosts, not aedilis (see `docs/aedilis-host-plan.md` §7b).
- Consider enabling Tailscale client metrics so the `tailscale{instance=aedilis}` scrape target is
  UP (fleet-wide gap noted in the audit §8).
