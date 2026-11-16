{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.system-podman = { pkgs }: {
    environment.system-packages = with pkgs; [
      podman-compose
    ];
  };
}
