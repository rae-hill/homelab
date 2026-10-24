{ inputs, ... }:
{
  flake.modules.nixos.technitium-caddy =
    {
      config,
      lib,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      inherit (lib) mkIf;
    in
    {
      imports = [ inputs.self.modules.nixos.caddy ];

      config = mkIf (cfg.enable && cfg.caddy.enable) {
        services.caddy = {
          enable = true;
          # Every vhost names its cert explicitly; the global default issuer is unused.
          useInternalCA = true;
        };

        # The admin UI + mTLS metrics HTTPS vhost BODIES now come from the service catalog
        # (features/technitium-aedilis/catalog.nix, rendered by the caddy generator). This
        # generic module keeps only the host-level Caddy settings + the cert-group->caddy
        # membership below.

        # Caddy needs read access to the admin + metrics ACME certs (owned by the
        # dedicated cert group) — NOT the service group or any secrets.
        users.groups.${cfg.certGroup}.members = [ "caddy" ];
      };
    };
}
