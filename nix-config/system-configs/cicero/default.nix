{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
  # Host-local flake-parts modules (system-configs isn't import-tree'd): the
  # cicero observability layer and the bespoke host files register
  # flake.modules.nixos.{cicero-observability*,host-cicero-*} via these imports.
  imports = [
    ./observability/alloy.nix
    ./observability/caddy-host.nix
    ./observability/catalog.nix
    ./observability/node-exporter.nix
    ./observability/complete.nix
    ./hardware.nix
    ./security.nix
    ./system.nix
    ./programs.nix
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
      nixos.system-security-pcscd
      nixos.users-human
      nixos.step-ca
      nixos.homelab-service-apphost
      nixos.cicero-observability

      nixos.host-cicero-hardware
      nixos.host-cicero-security
      nixos.host-cicero-system
      nixos.host-cicero-programs
      ./sops.nix

      { networking.hostName = "cicero"; }
    ];
  };
}
