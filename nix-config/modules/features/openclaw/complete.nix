# openclaw — aggregator (darwin). Registers the user-level gateway service on mini.
# Phase 3 will add catalog.nix (tailnet vhost openclaw.plato-splunk.media).
#
# See docs/openclaw-mini-plan.md.
{ inputs, ... }:
{
  flake.modules.darwin.openclaw = {
    imports = with inputs.self.modules.darwin; [
      openclaw-service
    ];
  };
}
