# Container/virtualization stack for hosts that run containers (merged from the
# old programs/virtualization.nix and services/podman-quadlet.nix). Hosts
# importing this must also load inputs.quadlet-nix.nixosModules.quadlet.
{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.desktop-virtualization =
    {
      config,
      lib,
      pkgs,
      ...
    }:
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

        quadlet = {
          enable = true;
          autoEscape = true;
          autoUpdate = {
            enable = true;
          };
        };
      };
    };
}
