{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
  # Host-local flake-parts modules (system-configs isn't import-tree'd, so the
  # bespoke host files register flake.modules.nixos.host-nixos-* via these
  # imports and are referenced below like any shared module).
  imports = [
    ./hardware.nix
    ./filesystems.nix
    ./security.nix
    ./system.nix
    ./programs.nix
  ];

  flake.nixosConfigurations.nixos = inputs.nixpkgs.lib.nixosSystem {
    system = "x86_64-linux";
    specialArgs = {
      inherit inputs;
      pkgs-unstable = import inputs.nixpkgs-unstable {
        system = "x86_64-linux";
        config.allowUnfree = true;
      };
    };
    modules = [
      inputs.home-manager.nixosModules.home-manager
      inputs.catppuccin.nixosModules.catppuccin
      inputs.nixvim.nixosModules.nixvim
      inputs.sops-nix.nixosModules.sops
      inputs.quadlet-nix.nixosModules.quadlet

      nixos.system-base
      nixos.system-boot-systemd
      nixos.system-networking
      nixos.system-security-base
      nixos.system-security-smartcard
      nixos.shell-ssh-server
      nixos.shell-ssh-client
      nixos.users-human
      nixos.desktop-complete
      nixos.desktop-1password-gui
      nixos.desktop-firefox
      nixos.desktop-uxplay-gnome
      nixos.desktop-via
      nixos.desktop-nvidia
      nixos.desktop-virtualization
      nixos.desktop-restic
      nixos.identity-kanidm-client
      nixos.games-steam
      nixos.system-cifs
      nixos.homelab-service-apphost
      nixos.opencode

      nixos.host-nixos-hardware
      nixos.host-nixos-filesystems
      nixos.host-nixos-security
      nixos.host-nixos-system
      nixos.host-nixos-programs
      ./sops.nix

      { networking.hostName = "nixos"; }
    ];
  };
}
