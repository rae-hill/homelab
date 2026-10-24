# mini-jellyfin — aggregator (darwin). Registers the three catalog entries and the
# hand-written global Caddyfile block + launchd daemon. The darwin caddy generator (imported
# by mini via darwin.homelab-service-apphost) renders the site-blocks fragment.
{ inputs, ... }:
{
  flake.modules.darwin.mini-jellyfin = {
    imports = with inputs.self.modules.darwin; [
      mini-jellyfin-catalog
      mini-jellyfin-caddy-host
    ];
  };
}
