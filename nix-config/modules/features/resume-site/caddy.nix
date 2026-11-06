# resume-site — loopback-only Caddy vhost serving the built resume SPA for
# homelab-api's headless chrome (POST /resume/print → RESUME_SITE_URL).
#
# Deliberately NOT a homelab.catalog entry: the catalog generator emits
# `https://<fqdn>` vhosts (DNS + TLS + firewall scopes). This site has no name,
# no cert, and no network exposure — plain HTTP bound to 127.0.0.1 so only
# processes on augustus (the chrome spawned by homelab-api) can reach it.
# Printing from the local build removes the public-GitHub-Pages dependency
# (which 414s on long URLs and whose third-party webfonts stalled).
{ config, inputs, ... }:
let
  svc = config.constants.services.homelab;
in
{
  flake.modules.nixos.resume-site-caddy =
    { config, lib, ... }:
    {
      options.services.resume-site = {
        enable = lib.mkEnableOption "loopback static resume site for homelab-api PDF printing";
      };

      config = lib.mkIf config.services.resume-site.enable {
        services.caddy.virtualHosts."http://127.0.0.1:${toString svc.resumeSitePort}" = {
          extraConfig = ''
            root * ${inputs.self.packages.x86_64-linux.resume-site}
            encode gzip
            # SPA deep-link fallback (the print flow only needs `/`, but the
            # oauth-callback route exists in the built app).
            try_files {path} /index.html
            file_server
          '';
        };

        # Point the PDF print service at the loopback vhost. Requires the
        # homelab-api feature module (which declares the option) — enable
        # resume-site only on hosts that run homelab-api. mkDefault so an
        # explicit host-level override still wins.
        services.homelab-api.resumeSiteUrl = lib.mkDefault "http://127.0.0.1:${toString svc.resumeSitePort}";
      };
    };
}
