# openclaw — catalog entry (darwin Caddyfile backend).
#
# Tailnet vhost openclaw.plato-splunk.media → 127.0.0.1:18789 (OpenClaw gateway: Control UI +
# WS control RPC). mTLS-gated (jacob 2026-11-09: "lock agents down with mTLS" — client certs on
# iPad/iPhone): `tls { client_auth require_and_verify; trust_pool <step-ca root> }`, same gate as
# the mini metrics vhosts; server cert stays Caddy-native ACME via step-ca (cert.shared). The
# gateway's own token auth remains active behind mTLS (defense in depth). DNS is emitted on
# aedilis via the flake-level catalogDns aggregate (service-registry.nix) →
# technitium-provisioning; DNS must resolve BEFORE mini's Caddy requests the cert (HTTP-01).
#
# NOTE: rootCert binds at the FILE level (flake-parts config, where `constants` lives) — the
# inner darwin module's `config` is the darwin system config, which has no `constants`
# (same structure as features/mini-jellyfin/catalog.nix).
#
# See docs/openclaw-mini-plan.md (D5, phase 3) + docs/service-consolidation/mini.md.
{ config, ... }:
let
  rootCert = config.constants.ca.rootCert; # certs/alford-root.crt (same store path as mini-jellyfin's mTLS vhosts)
in
{
  flake.modules.darwin.openclaw-catalog =
    { ... }:
    {
      homelab.catalog = {
        openclaw = {
          subdomain = "openclaw";
          host = "mini";
          backend.reverseProxy.port = 18789; # 127.0.0.1:18789
          tls = {
            gate.mtls.trustPoolFile = rootCert; # serverCert defaults to managed (darwin: Caddy ACME)
            cert.shared = { };
          };
          dns.tailnet = { }; # openclaw A/AAAA (-> mini tailnet addr), emitted on aedilis
          managedBy = {
            caddy = true;
            dns = true;
          };
        };
      };
    };
}
