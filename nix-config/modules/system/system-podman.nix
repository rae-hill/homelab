{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.system-podman = { pkgs, ... }: {
    environment.systemPackages = with pkgs; [
      podman-compose
    ];
  };
}
