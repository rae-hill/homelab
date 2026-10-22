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

      nixos.system-base
      nixos.gnome-desktop
      nixos.nvidia
      nixos.virtualization
      nixos.cifs
      nixos.restic
      nixos.uxplay
      nixos.kanidm-client

      ./../_private/nixos/hardware.nix
      ./../_private/nixos/filesystems.nix
      ./../_private/nixos/security.nix
      ./../_private/nixos/users.nix
      ./../_private/nixos/sops.nix
      ./../_private/nixos/system.nix
      ./../_private/nixos/programs.nix

      { networking.hostName = "nixos"; }
    ];
  };
}
