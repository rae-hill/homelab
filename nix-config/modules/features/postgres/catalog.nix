# postgres — catalog entry (manual step-ca cert consumed by the postgres server via postRun).
#
# No https vhost (postgres speaks the PG wire protocol on 5432, not HTTP). The catalog owns only
# the cert + its bare http challenge vhost. The cert uses a `postRun` hook (NOT reloadServices,
# NOT a caddy reload) that kicks postgresql-update-certs. Gated on services.peesequel.enable so a
# host without postgres emits nothing (matches today's lib.mkIf cfg.enable).
{ config, ... }:
let
  svc = config.constants.services.postgres; # subdomain "postgres-augustus", acmePort 41872
in
{
  flake.modules.nixos.postgres-catalog =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      homelab.catalog.postgres = lib.mkIf config.services.peesequel.enable {
        subdomain = svc.subdomain; # "postgres-augustus"
        host = "augustus";
        backend.none = { }; # no https vhost
        tls.cert.own = {
          ca = "internal";
          acmePort = svc.acmePort; # 41872
          certGroup = "postgres-certs";
          reloadServices = [ ]; # postgres uses postRun, not reloadServices
          reloadCaddy = false; # no Caddy vhost names this cert
          postRun = "${pkgs.systemd}/bin/systemctl start postgresql-update-certs.service";
          challenge = {
            via = "caddy80";
            body.bare = { }; # today's http://postgres-augustus vhost is a bare reverse_proxy
          };
        };
        access.scope.tailnet = { };
        dns.tailnet = { };

        managedBy.acme = true;
      };
    };
}
