{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
  # Host-local flake-parts modules (system-configs isn't import-tree'd, so the
  # cicero observability layer is imported explicitly here).
  imports = [
    ./observability/alloy.nix
    ./observability/caddy-host.nix
    ./observability/catalog.nix
    ./observability/node-exporter.nix
    ./observability/complete.nix
  ];

  flake.nixosConfigurations.cicero = inputs.nixpkgs.lib.nixosSystem {
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
      inputs.nixvim.nixosModules.nixvim
      inputs.sops-nix.nixosModules.sops

      nixos.system-base
      nixos.system-nix-base
      nixos.system-locale
      nixos.system-boot-systemd
      nixos.system-networking
      nixos.system-security-base
      nixos.step-ca
      nixos.homelab-service-apphost
      nixos.cicero-observability

      ./hardware.nix
      ./security.nix
      ./users.nix
      ./sops.nix
      ./system.nix
      ./programs.nix

      { networking.hostName = "cicero"; }
    ];
  };
}
