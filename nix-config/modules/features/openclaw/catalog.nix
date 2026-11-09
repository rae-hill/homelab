# openclaw — catalog entry (darwin Caddyfile backend).
#
# Tailnet vhost openclaw.plato-splunk.media → 127.0.0.1:18789 (OpenClaw gateway: Control UI +
# WS control RPC). Plain shared cert — Caddy-native ACME via step-ca (global acme_ca in the
# hand-written Caddyfile), same as the jellyfin vhost; no mTLS gate: the DNS name is tailnet-only
# and the gateway enforces its own token auth. Caddy handles the WS Upgrade + the HTTP-01
# challenge (auto :80 listener) — DNS must resolve BEFORE mini's Caddy requests the cert, i.e.
# deploy aedilis (Technitium provisioning of the catalogDns aggregate) first.
#
# See docs/openclaw-mini-plan.md (D5, phase 3) + docs/service-consolidation/mini.md.
{ ... }:
{
  flake.modules.darwin.openclaw-catalog =
    { ... }:
    {
      homelab.catalog = {
        openclaw = {
          subdomain = "openclaw";
          host = "mini";
          backend.reverseProxy.port = 18789; # 127.0.0.1:18789
          tls.cert.shared = { }; # Caddy-native server cert; no gate (gateway token auth)
          dns.tailnet = { }; # openclaw A/AAAA (-> mini tailnet addr), emitted on aedilis
          managedBy = {
            caddy = true;
            dns = true;
          };
        };
      };
    };
}
