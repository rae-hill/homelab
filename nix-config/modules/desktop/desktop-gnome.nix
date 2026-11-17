{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.desktop-gnome = { pkgs, ... }: {
    services.udev.packages = [ pkgs.gnome-settings-daemon ];

    environment.systemPackages = with pkgs; [
      gnomeExtensions.appindicator
    ];

    environment.gnome.excludePackages = with pkgs; [
      orca
      geary
      gnome-backgrounds
      gnome-tour
      gnome-user-docs
      epiphany
      gnome-text-editor
      gnome-calculator
      gnome-contacts
      gnome-music
      simple-scan
      totem
      yelp
    ];

    nixpkgs.overlays = [
      (final: prev: {
        gnome-keyring = prev.gnome-keyring.overrideAttrs (oldAttrs: {
          configureFlags = (builtins.filter (flag: flag != "--Dssh-agent=true") oldAttrs.mesonFlags) ++ [
            "--Dssh-agent=false"
          ];
        });
      })
    ];
  };

  # Home-Manager
  flake.modules.homeManager.desktop-gnome =
    { inputs, ... }:
    {
      dconf = {
        enable = true;
      };
    };
}
