{ inputs, ... }:
{
  flake.modules.nixos.host-nixos-programs =
    {
      lib,
      config,
      pkgs,
      pkgs-unstable,
      ...
    }:
    {
      # Everything else moved to shared modules — wired in default.nix:
      #   dconf/gnome            -> desktop-gnome
      #   firefox (system)       -> desktop-firefox
      #   steam + gamemode       -> games-steam
      #   1password (+gui, etc)  -> desktop-1password-gui (via desktop-complete + direct)
      #   zoom                   -> desktop-zoom (via desktop-complete)
      #   zsh                    -> shell-zsh (via desktop-complete)
      #   via/qmk udev + package -> desktop-via
      #   vim/git/openssl/cifs-utils/restic/step-cli -> system-programs
      #   podman-compose         -> system-podman
      #   quickemu               -> system-emulation
      # Dropped on purpose (marked "won't include" — provided via home-manager or
      # retired): home-manager, geekbench, git-credential-manager, mangohud,
      # starship, zsh (package).

      environment.systemPackages = with pkgs; [
        adwaita-icon-theme
      ];
    };
}
