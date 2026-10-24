# technitium (aedilis) — catalog entries: 3 ACME certs + their challenge vhosts + the admin &
# metrics HTTPS vhosts.
#
# Three domains:
#   - technitium (dns)   : PUBLIC Let's Encrypt cert for native DoH/DoT/DoQ termination (consumed
#                          by the Technitium service, NOT Caddy). No Caddy HTTPS vhost -> the entry
#                          owns the cert + its handle+redirect challenge vhost only (clientCertOnly).
#   - dns-admin          : step-ca cert + the admin UI HTTPS vhost (plain manual-TLS reverse-proxy;
#                          OIDC-gated by Technitium itself, no mTLS).
#   - dns-metrics        : step-ca cert + the mTLS + path-allowlist metrics HTTPS vhost (bespoke body
#                          via backend.raw/extraCaddyConfig), + the Alloy client cert consumer.
#
# The Technitium option module (services.technitium-server-complete.*) still PRODUCES the cert-path
# option values; this entry feeds them into the catalog. The generic technitium/caddy.nix keeps only
# the host-level Caddy settings + the cert-group->caddy membership (its two vhost bodies moved here).
#
# See docs/service-consolidation/technitium-aedilis.md + technitium-caddy.md.
{ config, ... }:
let
  c = config.constants;
  tech = c.services.technitium;
  dnsMetrics = c.services.dns-metrics;
in
{
  flake.modules.nixos.technitium-aedilis-catalog =
    { config, ... }:
    let
      cfg = config.services.technitium-server-complete;
      metricsCertDir = config.security.acme.certs."${dnsMetrics.domain}".directory;
    in
    {
      homelab.catalog = {
        # (1) Public DNS endpoint cert — Let's Encrypt, consumed by Technitium (no Caddy vhost).
        technitium = {
          subdomain = tech.subdomain; # "dns"
          host = "aedilis";
          clientCertOnly = true; # owns the cert + challenge, but NO Caddy https vhost
          backend.none = { };
          tls.cert.own = {
            ca = "letsencrypt";
            email = "rae@plato-splunk.media";
            acmePort = tech.acmePort; # 22482
            certGroup = cfg.group; # "technitium" — service reads it for PKCS#12 conversion
            reloadServices = [
              "technitium-dns-server.service"
              "technitium-provision.service"
            ]; # caddy.service prepended via reloadCaddy
            reloadCaddy = true;
            challenge = {
              via = "caddy80";
              body.handle.redirectToHttps = true; # handle challenge + redir to https
            };
          };
          access.scope.tailnet = { };
          dns = null; # dns A/AAAA stays in the authoritative zone fold until the DNS cutover
          managedBy.acme = true;
        };

        # (2) Admin UI vhost — step-ca cert, plain manual-TLS reverse-proxy (no mTLS).
        dns-admin = {
          subdomain = tech.adminSubdomain; # "dns-admin"
          host = "aedilis";
          listenPort = tech.adminPort; # 8443

          backend.reverseProxy.port = tech.webHttpPort; # 127.0.0.1:5380

          tls.cert.own = {
            ca = "internal";
            acmePort = tech.adminAcmePort; # 22483
            certGroup = cfg.certGroup; # "technitium-certs"
            reloadServices = [ ]; # caddy.service via reloadCaddy
            reloadCaddy = true;
            challenge = {
              via = "caddy80";
              body.bare = { }; # today's http://dns-admin vhost is a bare reverse_proxy
            };
          };
          # gate.none (default): renderer emits `tls <cert> <key>\nreverse_proxy 127.0.0.1:5380`.
          access.scope.tailnet = { };
          dns.tailnet = { }; # dns-admin A/AAAA (-> aedilis tailnet addr)
          managedBy = {
            caddy = true;
            acme = true;
            firewall = true;
            dns = true;
          };
        };

        # (3) Metrics vhost — step-ca cert, mTLS + path allowlist (bespoke body). Also the Alloy
        # client cert consumer.
        dns-metrics = {
          subdomain = dnsMetrics.subdomain; # "dns-metrics"
          host = "aedilis";
          listenPort = dnsMetrics.port; # 9443

          backend.raw = { }; # bespoke body supplied verbatim via extraCaddyConfig
          tls.cert.own = {
            ca = "internal";
            acmePort = dnsMetrics.acmePort; # 22481
            certGroup = cfg.certGroup; # "technitium-certs"
            reloadServices = [ "alloy.service" ]; # caddy.service via reloadCaddy
            reloadCaddy = true;
            challenge = {
              via = "caddy80";
              body.bare = { }; # today's http://dns-metrics vhost is a bare reverse_proxy
            };
          };
          access.scope.tailnet = { };
          dns.tailnet = { }; # dns-metrics A/AAAA (-> aedilis tailnet addr)

          # Verbatim reproduction of technitium/caddy.nix's metrics vhost body: explicit cert +
          # mTLS client_auth + the tight path allowlist (@node /metrics, @dns metrics, @login) +
          # respond 404.
          extraCaddyConfig = ''
            tls ${metricsCertDir}/fullchain.pem ${metricsCertDir}/key.pem {
              client_auth {
                mode require_and_verify
                trust_pool file {
                  pem_file ${c.ca.rootCert}
                }
              }
            }

            @node path /metrics
            handle @node {
              reverse_proxy 127.0.0.1:${toString dnsMetrics.nodeExporterPort}
            }

            @dns path /api/dashboard/metrics/text
            handle @dns {
              reverse_proxy 127.0.0.1:${toString tech.webHttpPort}
            }

            # The scrape token is minted by augustus's technitium-metrics-token
            # oneshot via POST /api/user/login over this same mTLS vhost (the
            # token then authorizes the /api/dashboard/metrics/text scrape). The
            # login path must be allowlisted or Caddy returns 404 and the token
            # mint fails ("login request failed"), leaving the DNS scrape target
            # DOWN. Keep the allowlist tight — only the login endpoint, not all
            # of /api/* — since mTLS is the only gate in front of it.
            @login path /api/user/login
            handle @login {
              reverse_proxy 127.0.0.1:${toString tech.webHttpPort}
            }

            handle {
              respond 404
            }
          '';

          managedBy = {
            caddy = true;
            acme = true;
            firewall = true;
            dns = true;
          };
        };
      };
    };
}
