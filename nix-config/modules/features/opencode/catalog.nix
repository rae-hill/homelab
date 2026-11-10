# opencode — catalog entry (mTLS web-UI vhost on the nixos workstation).
#
# NEW catalog-native service (not a migration). The opencode web server is a
# home-manager systemd USER service (`programs.opencode.web` in
# modules/home/jacob-nixos.nix) running `opencode serve --service` on LOOPBACK
# only (the managed background service the local TUI auto-attaches to); this
# entry owns the cross-cutting networking contract:
#
#   - Caddy vhost https://opencode.plato-splunk.media reverse-proxying into the
#     loopback listener (127.0.0.1:<port> — never exposed directly).
#   - Caddy-managed server cert from the internal step-ca (host-level
#     `useInternalCA`, see caddy-host.nix), gated by mutual TLS with the step-ca
#     root as trust pool — only device client certs chain to it (same gate as
#     loki-push / cicero-metrics).
#   - Tailscale-only :443 (access.scope.tailnet → the firewall generator opens
#     tailscale0 alone; NOT reachable from the LAN or the internet).
#   - A/AAAA on aedilis pointing at the nixos tailnet address (the record itself
#     is folded from flake.catalogDns in service-registry.nix; `dns`/`managedBy.dns`
#     here are declared intent).
#
# The HTTP-01 challenge for the managed cert arrives over the tailnet on :80,
# opened by hand in _private/nixos/security.nix (mirrors cicero).
#
# See docs/service-consolidation/opencode.md.
{ config, ... }:
let
  c = config.constants;
  svc = c.services.opencode; # subdomain "opencode", port 49375
in
{
  flake.modules.nixos.opencode-catalog =
    { ... }:
    {
      homelab.catalog.opencode = {
        subdomain = svc.subdomain; # fqdn opencode.plato-splunk.media
        host = "nixos";

        # Reverse-proxy into the loopback opencode-web user service.
        backend.reverseProxy.port = svc.port; # 49375

        tls = {
          # Caddy manages the server cert via the internal step-ca (useInternalCA);
          # no security.acme.certs entry.
          cert.shared = { };
          # Client-cert gated: mutual TLS using the step-ca root as trust pool.
          gate.mtls.trustPoolFile = c.ca.rootCert; # alford-root.crt; serverCert "managed"
        };

        # Tailscale-only: the firewall generator opens :443 on tailscale0 alone.
        access.scope.tailnet = { };

        # Emit the opencode A/AAAA on aedilis (-> nixos tailnet addr).
        dns.tailnet = { };

        managedBy = {
          caddy = true;
          firewall = true;
          dns = true;
        };
      };
    };
}
