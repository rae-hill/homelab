# kanidm — catalog entry (manual step-ca cert on the `idm` group; bespoke TLS-upstream vhost).
#
# The canonical manual-TLS case. backend.kind = "raw": the vhost body (explicit tls + tracing
# span + HTTPS-upstream reverse_proxy with pinned tls_server_name) is supplied verbatim via
# extraCaddyConfig, reproducing today's byte-for-byte. The idm ACME challenge vhost is a bare
# reverse_proxy (acme generator, body="bare"). The cert lives on the per-service `idm` group
# with reloadServices=[kanidm.service] (+ caddy via reloadCaddy).
#
# APPROVED DEVIATION: the `ldap` route and its DNS record are REMOVED (not modeled) — LDAP is
# unused and the homelab is OIDC-exclusive. The server's own LDAP bindaddress stays in
# service.nix for config parity.
{ config, ... }:
let
  svc = config.constants.services.kanidm; # subdomain "idm", acmePort 64073
in
{
  flake.modules.nixos.kanidm-catalog =
    { config, ... }:
    let
      certDir = config.security.acme.certs."${svc.domain}".directory;
      instanceUrl = config.services.kanidm.provision.instanceUrl;
    in
    {
      homelab.catalog.kanidm = {
        subdomain = svc.subdomain; # "idm"
        host = "augustus";
        backend.kind = "raw"; # bespoke body below; renderer emits ONLY extraCaddyConfig
        tls = {
          ca = "internal";
          acmePort = svc.acmePort; # 64073
          certGroup = "idm"; # per-service group (default would be "kanidm")
          reloadServices = [ "kanidm.service" ]; # caddy.service added via reloadCaddy
          reloadCaddy = true;
          challenge = {
            via = "caddy80";
            body = "bare"; # today's http://idm vhost is a bare reverse_proxy
          };
        };
        access.scope = "tailnet";
        dns.enable = true;

        # Bespoke vhost body — reproduces today's kanidm.nix verbatim (explicit cert, tracing
        # span [unconditional, matching the source], HTTPS-upstream transport with pinned SNI).
        extraCaddyConfig = ''
          tls "${certDir}/fullchain.pem" "${certDir}/key.pem"
          tracing {
            span kanidm
          }
          reverse_proxy ${instanceUrl} {
            header_up HOST {host}
            transport http {
              tls_server_name ${svc.domain}
            }
          }
        '';

        managedBy.caddy = true;
        managedBy.acme = true;
      };
    };
}
