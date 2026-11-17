{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
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
      nixos.desktop-gnome
      nixos.desktop-nvidia
      nixos.desktop-virtualization
      nixos.cifs
      nixos.desktop-restic
      nixos.desktop-uxplay
      nixos.desktop-uxplay-gnome
      nixos.desktop-kanidm
      nixos.homelab-service-apphost
      nixos.opencode

      ./hardware.nix
      ./filesystems.nix
      ./security.nix
      ./users.nix
      ./sops.nix
      ./system.nix
      ./programs.nix

      { networking.hostName = "nixos"; }
    ];
  };
}
