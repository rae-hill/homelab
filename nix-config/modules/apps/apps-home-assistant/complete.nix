# home-assistant — feature aggregate. Preserves the `nixos.home-assistant` import name.
{ inputs, ... }:
{
  flake.modules.nixos.home-assistant = {
    imports = with inputs.self.modules.nixos; [
      home-assistant-catalog
      home-assistant-service
    ];
  };
}
