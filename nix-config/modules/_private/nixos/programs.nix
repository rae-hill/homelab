{
  lib,
  config,
  pkgs,
  pkgs-unstable,
  ...
}:
{
  programs.dconf.enable = true;

  programs.firefox.enable = true;

  programs.steam = {
    enable = true;
    gamescopeSession.enable = true;
    remotePlay.openFirewall = true;
  };

  programs.gamemode.enable = true;

  programs._1password.enable = true;

  programs._1password-gui = {
    enable = true;
    polkitPolicyOwners = [ "jacob" ];
  };

  # No home-manager module :(
  programs.zoom-us = {
    enable = true;
    package = pkgs-unstable.zoom-us;
  };

  environment.etc = {
    "1password/custom_allowed_browsers" = {
      text = ''
        vivaldi-bin
      '';
      mode = "0755";
    };
  };

  programs.zsh.enable = true;

  services.udev.packages = with pkgs; [
    via
    qmk-udev-rules
    gnome-settings-daemon
  ];

  environment.systemPackages = with pkgs; [
    home-manager
    vim
    geekbench
    git
    git-credential-manager
    mangohud
    starship
    zsh
    via
    quickemu
    adwaita-icon-theme
    gnomeExtensions.appindicator
    gnomeExtensions.uxplay-control
    uxplay
    openssl
    cifs-utils
    restic
    step-cli
    podman-compose
    nvidia-vaapi-driver
  ];

  environment.variables = {
    LIBVA_DRIVER_NAME = "nvidia";
    NVD_BACKEND = "direct";
  };

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
    gnome-maps
    gnome-music
    simple-scan
    totem
    yelp
  ];
}
