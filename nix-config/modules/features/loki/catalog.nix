# loki — catalog entry (mTLS + tracing push-ingest vhost).
#
# The externally-reachable surface is `loki-push` (a distinct subdomain), NOT `loki` (the
# runtime is loopback-only on 127.0.0.1:3100). The catalog owns ONLY the cross-cutting
# networking contract for loki-push: a client-cert-gated vhost (mutual TLS with the step-ca
# root as trust pool), a tracing span, and the reverse-proxy into the loopback listener.
#
# loki does NOT terminate its own manual cert — Caddy manages the loki-push server cert via
# managed/on-demand issuance. So `tls.cert.shared = { }` (no security.acme.certs entry, no
# HTTP-01 challenge vhost), yet `tls.gate.mtls` IS set (the gate is orthogonal to the cert).
#
# See docs/service-consolidation/loki.md.
{ config, ... }:
let
  c = config.constants;
  loki = c.services.loki; # runtime facts (port 3100)
in
{
  flake.modules.nixos.loki-catalog =
    { ... }:
    {
      homelab.catalog.loki-push = {
        subdomain = "loki-push"; # fqdn loki-push.plato-splunk.media == c.services.loki-push.url
        host = "augustus";

        # Reverse-proxy into the loopback loki HTTP listener (127.0.0.1:3100).
        backend.reverseProxy.port = loki.port; # 3100

        tls = {
          # Caddy manages the server cert; no security.acme.certs entry.
          cert.shared = { };
          # Client-cert gated: mutual TLS using the step-ca root as trust pool.
          gate.mtls.trustPoolFile = c.ca.rootCert; # alford-root.crt
        };

        # The tracing span { span loki-push } is emitted by the renderer when the host runs
        # Tempo; opt in here (matches today's unconditional span, gated on tempo.enable).
        tracing.enable = true;

        # Reachable over the tailnet; opens nothing new (443 is a baseline host opening).
        access.scope.public = { }; # augustus serves this vhost on the public :443 interface

        # Emit the loki-push A/AAAA on aedilis (reproduces tailnetRewrites.loki-push).
        dns.tailnet = { };

        # The caddy generator owns the vhost now. DNS deferred to the DNS cutover.
        managedBy = {
          caddy = true;
          firewall = true;
          dns = true;
        };
      };
    };
}
