{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
  # Host-local flake-parts modules (system-configs isn't import-tree'd, so the
  # bespoke host files register flake.modules.nixos.host-praeconinus-* via
  # these imports and are referenced below like any shared module).
  imports = [
    ./hardware.nix
    ./security.nix
    ./system.nix
    ./programs.nix
  ];

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
      nixos.users-human
      nixos.caddy
      nixos.homelab-api-service
      nixos.homelab-secret-provisioner

      nixos.host-praeconinus-hardware
      nixos.host-praeconinus-security
      nixos.host-praeconinus-system
      nixos.host-praeconinus-programs
      ./sops.nix

      { networking.hostName = "praeconinus"; }
    ];
  };
}
