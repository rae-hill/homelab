# radius — catalog entry (manual step-ca cert, consumed by the radiusd container).
#
# No https vhost (radiusd speaks RADIUS on 1812/1813, not HTTP). The catalog owns only the
# cert + its http://radius ACME challenge vhost. The cert reloads the container (NOT caddy).
# The 1812/1813 firewall openings are PUBLIC/multi-proto and stay baseline (managedBy.firewall
# off).
{ config, ... }:
let
  svc = config.constants.services.radius; # subdomain "radius", acmePort 22378
in
{
  flake.modules.nixos.radius-catalog =
    { ... }:
    {
      homelab.catalog.radius = {
        subdomain = svc.subdomain;
        host = "augustus";
        backend.kind = "none"; # no https vhost; managedBy.caddy stays off
        tls = {
          ca = "internal";
          acmePort = svc.acmePort; # 22378
          certGroup = "radiusd";
          reloadServices = [ "podman-radiusd.service" ];
          reloadCaddy = false; # no Caddy vhost names this cert
          challenge = {
            via = "caddy80";
            body = "bare"; # today's http://radius vhost is a bare reverse_proxy
          };
        };
        access.scope = "tailnet"; # not used (no listen port opened; firewall unmanaged)
        dns.enable = true;

        # Only the acme generator acts (cert + bare challenge vhost). No caddy https vhost,
        # no oidc, no firewall (1812/1813 stay baseline).
        managedBy.acme = true;
      };
    };
}
