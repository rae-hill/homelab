{ inputs, ... }:
{
  #########################################
  # NixOS (for system-wide programs, etc) #
  #########################################
  flake.modules.nixos.desktop-nixos-base = {
    imports = with inputs.self.modules.nixos; [
      system-nix-base
      system-programs
      system-locale
      shell-zsh
    ];
  };

  flake.modules.nixos.desktop-complete = {
    imports = with inputs.self.modules.nixos; [
      desktop-nixos-base
      desktop-1password
      desktop-zoom
      desktop-gnome
      desktop-uxplay
      system-podman
      system-emulation
      system-fonts
    ];
  };

  # --- headless --- #
  flake.modules.nixos.desktop-headless-complete = {
    imports = with inputs.self.modules.nixos; [
      desktop-nixos-base
      system-networking
    ];
  };

  # --- gnome --- #
  flake.modules.nixos.desktop-gnome-complete = {
    imports = with inputs.self.modules.nixos; [
      desktop-gnome
      desktop-uxplay-gnome
    ];
  };

  ###############
  # Home-Manager #
  ################
  flake.modules.homeManager.desktop-complete = {
    imports = with inputs.self.modules.homeManager; [
      system-nix-base
      desktop-vivaldi
      desktop-firefox
    ];
  };

  # --- gnome ---
  flake.modules.homeManager.desktop-gnome-complete = {
    imports = with inputs.self.modules.homeManager; [
      desktop-gnome
    ];
  };

  # --- games ---
  flake.modules.homeManager.games-complete = {
    imports = with inputs.self.modules.homeManager; [
      games-steam
      games-mangohud
    ];
  };

  # --- shell ---
  flake.modules.homeManager.shell-complete = {
    imports = with inputs.self.modules.homeManager; [
      shell-starship
    ];
  };
}
