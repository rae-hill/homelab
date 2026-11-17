# uxplay (AirPlay receiver) — merged from the old services/uxplay.nix (avahi
# mDNS publishing) and features/home/desktop/desktop-uxplay.nix (package).
{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.desktop-uxplay = { pkgs, ... }: {
    environment.systemPackages = with pkgs; [
      uxplay
    ];

    services.avahi = {
      enable = true;
      nssmdns4 = true;
      publish = {
        enable = true;
        userServices = true;
        addresses = true;
        workstation = true;
      };
      openFirewall = true;
    };
  };

  flake.modules.nixos.desktop-uxplay-gnome = { pkgs, ... }: {
    environment.systemPackages = with pkgs; [
      gnomeExtensions.uxplay-control
    ];
  };
}
