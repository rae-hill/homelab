{
  flake.modules.nixos.virtualization =
    { config, lib, pkgs, ... }:
    {
      virtualisation = {
        containers.enable = true;
        podman = {
          enable = true;
          dockerCompat = true;
          defaultNetwork.settings = {
            dns_enabled = true;
          };
        };
      };
    };
}
