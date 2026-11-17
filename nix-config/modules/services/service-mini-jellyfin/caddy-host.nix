# mini-jellyfin — host-level Caddyfile global block + launchd daemon (darwin).
#
# The global block (email, acme_ca, acme_ca_root, storage, admin off, metrics, debug) is NOT
# catalog-expressible (whole-Caddyfile options with no per-service meaning), so it stays
# hand-written. The inline site blocks are replaced by `import /etc/caddy_nix/catalog-sites.caddy`
# — the fragment the darwin caddy generator writes. The launchd daemon is unchanged (still reads
# /etc/caddy_nix/Caddyfile).
#
# See docs/service-consolidation/mini.md §2.2.
{ ... }:
{
  flake.modules.darwin.mini-jellyfin-caddy-host =
    { pkgs, ... }:
    {
      environment.etc."caddy_nix/Caddyfile".text = ''
        {
          email web@jacob-alford.dev
          acme_ca https://ca.plato-splunk.media/acme/http/directory
          acme_ca_root /etc/step/certs/root_ca.crt

          storage file_system /etc/caddy

          admin off
          metrics
          debug
        }

        import /etc/caddy_nix/catalog-sites.caddy
      '';

      launchd.daemons.caddy = {
        command = "${pkgs.caddy}/bin/caddy run --config /etc/caddy_nix/Caddyfile --adapter caddyfile";
        serviceConfig = {
          KeepAlive = true;
          RunAtLoad = true;
          StandardOutPath = "/etc/caddy/logs/caddy.info.log";
          StandardErrorPath = "/etc/caddy/logs/caddy.err.log";
        };
      };
    };
}
