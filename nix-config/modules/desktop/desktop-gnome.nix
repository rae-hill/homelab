# GNOME desktop stack (merged from the old programs/gnome-desktop.nix and
# features/home/desktop/desktop-gnome.nix).
{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.desktop-gnome = { pkgs, ... }: {
    services.desktopManager.gnome.enable = true;

    # Required by the HM dconf module (home-configs' desktop-gnome).
    programs.dconf.enable = true;

    services.displayManager.gdm.enable = true;

    services.gnome.gcr-ssh-agent.enable = false;

    services.printing.enable = true;

    services.pulseaudio.enable = false;

    services.avahi = {
      enable = true;
      nssmdns4 = true;
      openFirewall = true;
    };

    services.xserver.xkb = {
      layout = "us";
      variant = "";
    };

    services.pipewire = {
      enable = true;
      alsa.enable = true;
      alsa.support32Bit = true;
      pulse.enable = true;
    };

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
      gnome-maps
      gnome-music
      simple-scan
      totem
      yelp
    ];

    # Disable gnome-keyring's built-in ssh-agent (it fights the gcr/ssh-agent
    # socket wiring); keys are handled by the HM ssh-agent / gcr unlock instead.
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
