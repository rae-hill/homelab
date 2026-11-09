# openclaw — aggregator (darwin). Registers the user-level gateway service and the tailnet
# Caddy vhost (openclaw.plato-splunk.media; DNS emitted on aedilis via catalogDns).
#
# See docs/openclaw-mini-plan.md.
{ inputs, ... }:
{
  flake.modules.darwin.openclaw = {
    imports = with inputs.self.modules.darwin; [
      openclaw-service
      openclaw-catalog
    ];
  };
}
