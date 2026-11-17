{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.desktop-uxplay = { pkgs, ... }: {
    environment.systemPackages = with pkgs; [
      uxplay
    ];
  };

  flake.modules.nixos.desktop-uxplay-gnome = { pkgs, ... }: {
    environment.systemPackages = with pkgs; [
      gnomeExtensions.uxplay-control
    ];
  };
}
