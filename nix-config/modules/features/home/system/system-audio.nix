{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.system-audio = { pkgs }: {
    security.rtkit.enable = true;
  };
}
