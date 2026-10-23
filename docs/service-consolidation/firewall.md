# `_private/<host>/security.nix` — Firewall: Service-Derived vs Baseline Infra

Status: **PROPOSED** · Cross-cutting plan under the
[service consolidation plan](../service-consolidation-plan.md) · Schema +
generators (§3.5 firewall): [catalog-and-generators.md](./catalog-and-generators.md) · Index:
[README](./README.md)

This plan reconciles the hand-written firewall rules in all **four Linux hosts**
(`_private/{augustus,aedilis,cicero,praeconinus}/security.nix`) against the catalog's
`homelab-service-firewall` generator (parent plan §2.7, keystone §3.5). Its job is to prove, per host,
that **today's rule set = (service-derived ports emitted by the generator) ∪ (baseline infra ports that
stay hand-listed)** — so that enabling the generator and deleting the migrated ports from the host files
is a **theoretical no-op** (operational equivalence, see [README](./README.md)).

Firewall changes are security-sensitive: the proof obligation here is a strict per-host **set equality**
gate (§4), not a narrative. Every port is classified (§2), assigned to a column — _generated_ or
_baseline_ (§3) — and the union is shown to equal the verbatim current set (§1, §3).

> **Scope.** `networking.firewall` is **inbound-only**. This plan covers the enforceable inbound
> openings. The "which hosts may reach whom" egress/peer matrix is **not** a firewall concern — it is a
> Tailscale/headscale ACL concern modeled as `access.fromHosts` _intent_ only (parent plan §2.7 / §5.2),
> never auto-applied, and out of scope for the per-host set-equality proof below. `mini` (darwin) keeps
> its hand-written firewall and is out of scope (parent plan §5.1 #4).

---

## 1. Current firewall rules — captured verbatim (all four Linux hosts)

Transcribed directly from each `_private/<host>/security.nix`. Interface `public` = the default
`networking.firewall.allowedTCPPorts`/`allowedUDPPorts` (internet-facing); `tailscale0` =
`networking.firewall.interfaces.tailscale0.*`.

### 1.1 augustus (primary app host)

```nix
networking.firewall = {
  enable = true;
  interfaces.tailscale0.allowedTCPPorts = [ 22 5252 5432 25565 ];
  allowedTCPPorts = [ 80 443 1812 1813 ];
  allowedUDPPorts = [ 1812 1813 ];
};
```

| Interface    | Proto | Ports                         |
| ------------ | ----- | ----------------------------- |
| public       | TCP   | `80`, `443`, `1812`, `1813`   |
| public       | UDP   | `1812`, `1813`                |
| `tailscale0` | TCP   | `22`, `5252`, `5432`, `25565` |

> Note vs. the request's prose summary: augustus's `tailscale0` TCP list is **`22 5252 5432 25565`**
> (there is **no** standalone `5252/udp` entry, and `25565` _is_ present) — transcribed from source.

### 1.2 aedilis (authoritative/recursive DNS + Technitium)

```nix
networking.firewall = {
  enable = true;
  allowedTCPPorts = [ 80 443 853 ];
  allowedUDPPorts = [ 853 ];
  interfaces.tailscale0 = {
    allowedTCPPorts = [ 22 53 8443 9443 5252 22481 22483 ];
    allowedUDPPorts = [ 53 ];
  };
};
```

| Interface    | Proto | Ports                                                |
| ------------ | ----- | ---------------------------------------------------- |
| public       | TCP   | `80`, `443`, `853`                                   |
| public       | UDP   | `853`                                                |
| `tailscale0` | TCP   | `22`, `53`, `8443`, `9443`, `5252`, `22481`, `22483` |
| `tailscale0` | UDP   | `53`                                                 |

### 1.3 cicero (certificate authority)

```nix
networking.firewall = {
  enable = true;
  interfaces.tailscale0.allowedTCPPorts = [ 22 80 443 5252 8443 ];
};
```

| Interface    | Proto | Ports                             |
| ------------ | ----- | --------------------------------- |
| `tailscale0` | TCP   | `22`, `80`, `443`, `5252`, `8443` |

(cicero opens **nothing** on the public interface — it is tailnet-only.)

### 1.4 praeconinus (Tailscale Funnel)

```nix
networking.firewall = {
  enable = true;
  interfaces.tailscale0 = {
    allowedTCPPorts = [ 22 443 5252 ];
    allowedUDPPorts = [ 5252 ];
  };
  allowedTCPPorts = [ 443 ];
};
```

| Interface    | Proto | Ports               |
| ------------ | ----- | ------------------- |
| public       | TCP   | `443`               |
| `tailscale0` | TCP   | `22`, `443`, `5252` |
| `tailscale0` | UDP   | `5252`              |

---

## 2. Port classification — SERVICE-DERIVED vs BASELINE INFRA

Per the parent plan decision (baseline infra stays explicit/hand-listed; the generator owns only
service-attributable openings — §5.1 #7), every port above is classified below. **Service-derived** =
the opening exists _because a catalog service runs on this host_ and the generator can emit it from that
service's catalog entry. **Baseline infra** = a host-level fact (SSH, tailnet metrics, the DNS resolver
core, protocol listeners) not attributable to any single catalog service — it stays hand-listed.

| Port            | Proto   | Classification          | Rationale / which concern                                                                   |
| --------------- | ------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| `22`            | TCP     | **BASELINE**            | SSH. Host-level; present on every host. `services.openssh.openFirewall = false` + explicit. |
| `5252`          | TCP/UDP | **BASELINE**            | Tailscale metrics exporter / webclient. Host-level infra on every host.                     |
| `53`            | TCP/UDP | **BASELINE**            | Technitium core DNS (plain, tailnet-only). The DNS _resolver_, not a catalog vhost.         |
| `80`            | TCP     | **BASELINE**\*          | HTTP-01 challenge front (Caddy :80) **and** Technitium's non-use. See §2.1 — host-level.    |
| `443`           | TCP     | **SERVICE-DERIVED**\*\* | The shared vhost listen port. On aedilis also DoH (Technitium-native) — see §2.2.           |
| `853`           | TCP/UDP | **BASELINE**            | Technitium DoT/DoQ (native TLS). The DNS resolver's own protocol listeners (aedilis).       |
| `1812`/`1813`   | TCP/UDP | **SERVICE-DERIVED**     | FreeRADIUS auth/acct (augustus `radius` service). Public, **non-443** — hard case §5.       |
| `5432`          | TCP     | **SERVICE-DERIVED**     | PostgreSQL (augustus `postgres`), tailnet-only. Non-443 — hard case §5.                     |
| `25565`         | TCP     | **SERVICE-DERIVED**     | Minecraft (augustus), tailnet-only. Non-443 — hard case §5.                                 |
| `8443`          | TCP     | **SERVICE-DERIVED**     | Service vhost on a non-standard port: aedilis Technitium admin UI; cicero metrics/UI.       |
| `9443`          | TCP     | **SERVICE-DERIVED**     | aedilis dns-metrics endpoint (Caddy, mTLS) — `service-registry` `dns-metrics.port`.         |
| `22481`/`22483` | TCP     | **SERVICE-DERIVED**     | aedilis internal step-ca ACME HTTP-01 challenge, **direct** on `tailscale0` — §2.3.         |

\* `80` is treated as **baseline** here (see §2.1) — it is the shared Caddy `:80` front for HTTP-01
challenges across _all_ a host's internal-CA certs (and on aedilis the LE challenge), not attributable to
one service. \*\* `443` is **service-derived** in the sense that it exists because the host serves
catalog vhosts, but it is emitted **once** per host (the generator de-dupes) — see §3.

### 2.1 Why `80` is baseline, not service-derived

The `acmePort` loopback listeners (`listenHTTP = 127.0.0.1:<acmePort>`) are fronted by Caddy on `:80`
via `handle /.well-known/acme-challenge/*` for the `challenge.via == "caddy80"` services (augustus,
cicero). The `:80` opening is therefore **one shared front** for _all_ of a host's caddy80-challenge
certs, not per-service — and it coexists with hosts that have no such certs. Classifying it baseline
keeps it hand-listed and avoids the generator having to reason about "does _any_ service on this host use
caddy80." (aedilis's `80` is the public LE HTTP-01 challenge for its public DoH cert — same baseline
rationale: a host-level challenge front.)

### 2.2 Why aedilis `443` is special

On augustus/cicero/praeconinus, `443` is the Caddy vhost listen port (service-derived). On **aedilis**,
`443` public is **DoH**, terminated **natively by Technitium** (not a Caddy vhost) — see the inline
comment in aedilis's `security.nix`. So aedilis's public `443` is arguably a _DNS-resolver protocol
listener_ (baseline), not a catalog-service vhost. This matters for the set-equality proof: the generator
must **not** be the thing that opens aedilis public `443`, because no `access.scope = "public"` catalog
vhost runs on aedilis (its Technitium admin/metrics vhosts are `tailscale0`-only on `8443`/`9443`). See
§3.2 — aedilis public `443`/`853`/`80` all stay baseline.

### 2.3 The subtle one: aedilis `22481`/`22483` direct ACME ports

These are the `acmePort` values of aedilis's **internal step-ca** certs for **tailnet-only** domains.
Unlike the caddy80 model, step-ca (on cicero) reaches the HTTP-01 challenge listener **directly over
Tailscale** on that port, so the port must be **opened on `tailscale0`** (not fronted by `:80`). These
two openings are exactly the `acmePort` constants hand-copied into `security.nix` today — the prime
service-derived candidates for generation via `tls.challenge = { via = "direct"; iface = "tailscale0"; }`
(keystone §3.5).

---

## 3. Target split — what the generator emits vs what stays hand-listed

Per decision §5.1 #7, the generator owns **only** service-derived openings; baseline infra stays in each
`_private/<host>/security.nix`. Below, per host, the exact generator output (from the keystone §3.5
`homelab-service-firewall` logic, filtering `host == networking.hostName` + `managedBy.firewall`) and the
residual hand-listed baseline — and the union is shown equal to §1.

The generator's logic (keystone §3.5), recapped:

- **listen-port openings:** for each local entry, open `listenPort` on the interface `access.scope`
  selects — `public → allowedTCPPorts`, `tailnet`/`host-list → tailscale0`, `funnel`/`none → nothing`;
  de-duplicated via `lib.unique`.
- **direct-challenge acmePorts:** for each local entry with `tls.ca != null` and
  `tls.challenge.via == "direct"`, open `tls.acmePort` on `tls.challenge.iface`.

### 3.1 augustus

| Port          | Column            | How the generator derives it (or why baseline)                                |
| ------------- | ----------------- | ----------------------------------------------------------------------------- |
| `443` (pub)   | **generated**     | public-scope catalog vhosts' `listenPort = 443`, emitted once (`lib.unique`). |
| `1812`/`1813` | **generated**\*\* | radius service — but **not a 443 listenPort and spans UDP** (hard case §5).   |
| `5432` (ts0)  | **generated**\*\* | postgres — non-443 tailnet port (hard case §5).                               |
| `25565` (ts0) | **generated**\*\* | minecraft — non-443 tailnet port (hard case §5).                              |
| `80` (pub)    | baseline          | shared Caddy `:80` HTTP-01 challenge front (§2.1).                            |
| `22` (ts0)    | baseline          | SSH.                                                                          |
| `5252` (ts0)  | baseline          | Tailscale metrics exporter.                                                   |

\*\* Only emitted by the generator **if** the schema gains the extra-port fields in §5. With the schema
_as written today_ (single `listenPort`, no UDP, no extra TCP list), `1812/1813/5432/25565` **cannot** be
generated and must **stay baseline/hand-listed**. See §5 for the decision.

Union check (schema-as-today): generated `{ pub TCP 443 }` ∪ baseline
`{ pub TCP 80, 1812, 1813; pub UDP 1812, 1813; ts0 TCP 22, 5252, 5432, 25565 }` =
`{ pub TCP 80 443 1812 1813; pub UDP 1812 1813; ts0 TCP 22 5252 5432 25565 }` — **equals §1.1.** ✅

### 3.2 aedilis

| Port                   | Column        | How derived / why baseline                                                            |
| ---------------------- | ------------- | ------------------------------------------------------------------------------------- |
| `8443` (ts0)           | **generated** | Technitium admin-UI catalog vhost, `access.scope = tailnet`, `listenPort = 8443`.     |
| `9443` (ts0)           | **generated** | dns-metrics catalog vhost (mTLS), `scope = tailnet`/`host-list`, `listenPort = 9443`. |
| `22481` (ts0)          | **generated** | internal-CA cert, `tls.challenge = { via = direct; iface = tailscale0 }` → acmePort.  |
| `22483` (ts0)          | **generated** | second internal-CA cert, same direct-challenge mechanism.                             |
| `80`/`443`/`853` (pub) | baseline      | Technitium-native DNS (LE challenge / DoH / DoT·DoQ) — **not** catalog vhosts (§2.2). |
| `22` (ts0)             | baseline      | SSH.                                                                                  |
| `53` (ts0 TCP/UDP)     | baseline      | Technitium plain DNS core.                                                            |
| `5252` (ts0)           | baseline      | Tailscale metrics exporter.                                                           |

Union check: generated `{ ts0 TCP 8443 9443 22481 22483 }` ∪ baseline
`{ pub TCP 80 443 853; pub UDP 853; ts0 TCP 22 53 5252; ts0 UDP 53 }` =
`{ pub TCP 80 443 853; pub UDP 853; ts0 TCP 22 53 5252 8443 9443 22481 22483; ts0 UDP 53 }` —
**equals §1.2.** ✅ (The `host-list` scope for `9443` mTLS metrics maps the `access.fromHosts = [
"augustus" ]` intent — but only the _interface_ is enforced today; the peer restriction is intent-only.)

### 3.3 cicero

| Port         | Column        | How derived / why baseline                                                    |
| ------------ | ------------- | ----------------------------------------------------------------------------- |
| `443` (ts0)  | **generated** | cicero-observability catalog vhost, `scope = tailnet`, `listenPort = 443`.    |
| `8443` (ts0) | **generated** | cicero metrics/observability vhost on non-standard port, `listenPort = 8443`. |
| `80` (ts0)   | baseline      | Caddy `:80` HTTP-01 challenge front for cicero's internal certs (§2.1).       |
| `22` (ts0)   | baseline      | SSH.                                                                          |
| `5252` (ts0) | baseline      | Tailscale metrics exporter.                                                   |

Union check: generated `{ ts0 TCP 443 8443 }` ∪ baseline `{ ts0 TCP 22 80 5252 }` =
`{ ts0 TCP 22 80 443 5252 8443 }` — **equals §1.3.** ✅

> cicero's `80`/`443`/`8443` are all `tailscale0`-scoped (it is tailnet-only). The generator picks
> `tailscale0` from `access.scope = tailnet`, matching today. `80` stays baseline per §2.1.

### 3.4 praeconinus

| Port                 | Column   | How derived / why baseline                                                       |
| -------------------- | -------- | -------------------------------------------------------------------------------- |
| `443` (pub)          | baseline | **Funnel ingress** terminated by tailscaled — host/Tailscale infra, not a vhost. |
| `443` (ts0)          | baseline | tailnet-side ingress; infra.                                                     |
| `22` (ts0)           | baseline | SSH.                                                                             |
| `5252` (ts0 TCP/UDP) | baseline | Tailscale metrics exporter.                                                      |

Generator output: **empty.** praeconinus's one catalog entry (if it had one — see
[praeconinus.md](./praeconinus.md), which recommends it stays a bespoke override) uses
`access.scope = "funnel"`, and funnel scope opens **nothing** (tailscaled owns `:443`; Caddy's `:8443`
is reached over loopback and is deliberately never firewalled). So **every** praeconinus port is
baseline/hand-listed.

Union check: generated `{ }` ∪ baseline `{ pub TCP 443; ts0 TCP 22 443 5252; ts0 UDP 5252 }` =
`{ pub TCP 443; ts0 TCP 22 443 5252; ts0 UDP 5252 }` — **equals §1.4.** ✅

### 3.5 Summary — generator ownership per host

| Host        | Generated (service-derived) ports                                            | Baseline (hand-listed) ports                                            |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| augustus    | `pub TCP 443` (+ `1812/1813`, `5432`, `25565` **iff** §5 schema fields land) | `pub TCP 80` (+ non-443 service ports until §5); `ts0 TCP 22 5252`      |
| aedilis     | `ts0 TCP 8443 9443 22481 22483`                                              | `pub TCP 80 443 853`; `pub UDP 853`; `ts0 TCP 22 53 5252`; `ts0 UDP 53` |
| cicero      | `ts0 TCP 443 8443`                                                           | `ts0 TCP 22 80 5252`                                                    |
| praeconinus | _(none — funnel scope opens nothing)_                                        | `pub TCP 443`; `ts0 TCP 22 443 5252`; `ts0 UDP 5252`                    |

---

## 4. Operational-equivalence gate (per-host set equality)

The migration proof obligation: **before** flipping any `managedBy.firewall` flag, capture each host's
firewall; **after** declaring the service-derived ports in the catalog and deleting them from
`security.nix`, re-capture; the two must be **set-equal** (order-insensitive). Because the generator uses
`lib.unique` and the hand lists may differ in order, compare as **sets**, not raw JSON arrays.

```sh
# Capture the full firewall object per host, before and after:
nix eval .#nixosConfigurations.augustus.config.networking.firewall --json
nix eval .#nixosConfigurations.aedilis.config.networking.firewall --json
nix eval .#nixosConfigurations.cicero.config.networking.firewall --json
nix eval .#nixosConfigurations.praeconinus.config.networking.firewall --json
```

Recommended set-equality recipe (normalize both sides by sorting each port list) — e.g. for augustus:

```sh
nix eval --json \
  .#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts \
  | jq -S 'sort' > /tmp/aug.pub.tcp.before.json
# …flip managedBy.firewall + delete the generated ports from security.nix…
nix eval --json \
  .#nixosConfigurations.augustus.config.networking.firewall.allowedTCPPorts \
  | jq -S 'sort' > /tmp/aug.pub.tcp.after.json
diff /tmp/aug.pub.tcp.before.json /tmp/aug.pub.tcp.after.json   # must be empty
```

Repeat for `allowedUDPPorts`, `interfaces.tailscale0.allowedTCPPorts`, and
`interfaces.tailscale0.allowedUDPPorts` on each host. An empty diff on **all** interface/proto lists for
**all four** hosts certifies the firewall change is a deploy no-op.

Per `.kiro/steering/validation.md`: **`git add` the new generator `.nix` files before any `nix eval`** —
flake eval reads the git tree, and an untracked new generator module is invisible to `import-tree`, which
would make the "after" eval silently identical to "before" and give a **false-positive** equality. After
the diffs pass, run `nix run .#nixfmt -- $(git ls-files '*.nix' ':!:repos/**')`, `nix flake check`, and a
full `nixos-rebuild build --flake .#<host>` for each of the four hosts before deploying.

---

## 5. Hard cases — public/non-443 service ports and schema coverage

The firewall generator's schema (keystone §3.5) assumes a service opens a single TCP `listenPort`
(default 443) on one interface, plus an optional direct-challenge acmePort. Four current openings **do
not fit** that shape. These are the cases to decide before claiming the generator can own them.

### 5.1 radius `1812`/`1813` — public, dual-proto (TCP **and** UDP), non-443

FreeRADIUS on augustus opens `1812`/`1813` on **both** TCP and UDP on the **public** interface. The
schema today models neither UDP nor a non-443 service port. To generate this, the catalog entry would
need **extra port fields** beyond `listenPort`, e.g.:

```nix
# proposed schema extension (NOT in the keystone schema as written):
extraPorts = {
  tcp = [ 1812 1813 ];
  udp = [ 1812 1813 ];
};
# access.scope = "public"  -> opens on allowedTCPPorts/allowedUDPPorts
```

`access.scope = "public"` already selects the correct interface; the gap is purely **UDP + a
multi-port, non-443 list**. Radius is not an HTTP vhost at all (no Caddy vhost, no ACME cert of the
challenge kind), so forcing it through `listenPort`/`backend` would misrepresent it.

**Recommendation:** add an `extraPorts { tcp; udp; }` field (interface chosen by `access.scope`) to the
schema, OR — simpler and lower-risk — **leave radius/postgres/minecraft baseline**. They are a _fixed,
tiny_ set of non-HTTP ports that do not drift (unlike the 443/acmePort boilerplate the catalog exists to
kill). Classifying them baseline keeps the generator's scope auditable (decision §5.1 #7's spirit) and
still achieves the real goal: eliminating the repeated `443` + hand-copied `acmePort` drift.

### 5.2 postgres `5432` — tailnet, non-443, non-HTTP

PostgreSQL on augustus, `tailscale0` only. Same shape problem as radius (non-443, non-HTTP, no vhost),
but TCP-only and single-port. Expressible via the same proposed `extraPorts.tcp` on a `tailnet`-scope
entry — or left baseline. Same recommendation: **baseline** unless `extraPorts` is adopted fleet-wide.

### 5.3 minecraft `25565` — tailnet, non-443, non-HTTP

Identical shape to postgres (single TCP port, tailnet, no vhost/cert). Same disposition: **baseline**
unless `extraPorts` lands.

### 5.4 Does `access.scope` + extra fields cover them? — verdict

- **Interface selection: yes.** `access.scope` (`public` vs `tailnet`) already picks the right firewall
  interface for every one of these ports, with no new fields.
- **Port/proto selection: no, not with the schema as written.** The single-TCP-`listenPort` model cannot
  express UDP (radius) or non-443 multi-port lists (radius) without a new `extraPorts { tcp; udp; }`
  field.
- **Recommended disposition:** keep `1812/1813/5432/25565` **baseline/hand-listed** in the near term
  (they are stable, non-drifting, non-HTTP). The generator owns the genuinely-repeated, drift-prone
  openings — `443` (de-duped per host) and the direct-challenge acmePorts (`22481`/`22483`). This matches
  the parent plan's framing that the generator owns _service-attributable boilerplate_, while
  host-specific non-HTTP listeners stay explicit. If a future service introduces _another_ non-HTTP
  tailnet port, revisit adding `extraPorts` so the pattern generalizes rather than accreting one-offs.

With that disposition, the §3 union checks hold **exactly as written** (the non-443 service ports sit in
the baseline column), and the per-host set-equality gate (§4) is satisfiable today without any schema
extension — the only _generated_ deltas are augustus/cicero/aedilis `443`/`8443`/`9443` vhost ports and
aedilis's two direct-challenge acmePorts.

---

## 6. Checklist (this cross-cutting plan)

- [ ] Confirm the §1 verbatim tables against live source before migrating (re-read each
      `_private/<host>/security.nix`; they drift).
- [ ] Classify every port per §2; keep `80`, `22`, `5252`, `53`, `853`, aedilis-public `443` **baseline**.
- [ ] Decide the §5 hard-case disposition: **recommended** — keep `1812/1813/5432/25565` baseline; do
      **not** add `extraPorts` yet.
- [ ] Generator owns per host: augustus `pub 443`; aedilis `ts0 8443/9443/22481/22483`; cicero
      `ts0 443/8443`; praeconinus **none** (funnel).
- [ ] Set each migrated service's catalog `access.scope` (+ `tls.challenge = { via = "direct"; iface =
      "tailscale0"; }` for aedilis's two internal certs) and flip `managedBy.firewall`.
- [ ] Delete **only** the generated ports from each `security.nix`; leave baseline ports hand-listed.
- [ ] `git add` the generator module, then run the §4 per-host **set-equality** diffs (sorted) across all
      four interface/proto lists on all four hosts — every diff must be empty.
- [ ] `nix flake check` + per-host `nixos-rebuild build` before deploying (security-sensitive change).
