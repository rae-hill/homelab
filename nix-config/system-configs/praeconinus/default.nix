{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
  flake.nixosConfigurations.praeconinus = inputs.nixpkgs.lib.nixosSystem {
    system = "aarch64-linux";
    specialArgs = {
      inherit inputs;
      pkgs-unstable = import inputs.nixpkgs-unstable {
        system = "aarch64-linux";
        config.allowUnfree = true;
      };
    };
    modules = [
      inputs.home-manager.nixosModules.home-manager
      inputs.nixvim.nixosModules.nixvim
      inputs.sops-nix.nixosModules.sops

      nixos.system-base
      nixos.system-nix-base
      nixos.system-locale
      nixos.system-boot-generic
      nixos.system-networking
      nixos.system-networking-forwarding
      nixos.system-security-base
      nixos.caddy
      nixos.homelab-api-service
      nixos.homelab-secret-provisioner

      ./hardware.nix
      ./security.nix
      ./users.nix
      ./sops.nix
      ./system.nix
      ./programs.nix

      { networking.hostName = "praeconinus"; }
    ];
  };
}
