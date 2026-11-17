{
  flake.modules.nixos.podman-quadlet =
    { config, lib, pkgs, ... }:
    {
      virtualisation.quadlet = {
        enable = true;
        autoEscape = true;
        autoUpdate = {
          enable = true;
        };
      };
    };
}
