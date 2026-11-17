{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
  # Host-local flake-parts modules (system-configs isn't import-tree'd): the
  # aedilis Technitium layer and the bespoke host files register
  # flake.modules.nixos.{technitium-aedilis*,host-aedilis-*} via these imports.
  imports = [
    ./technitium.nix
    ./hardware.nix
    ./security.nix
    ./system.nix
    ./programs.nix
  ];

  flake.nixosConfigurations.aedilis = inputs.nixpkgs.lib.nixosSystem {
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
      nixos.system-boot-base
      nixos.system-boot-grub
      nixos.system-networking-dns-host
      nixos.system-security-base
      nixos.users-human
      nixos.homelab-service-dns-host
      nixos.technitium-aedilis

      nixos.host-aedilis-hardware
      nixos.host-aedilis-security
      nixos.host-aedilis-system
      nixos.host-aedilis-programs
      ./sops.nix

      { networking.hostName = "aedilis"; }
    ];
  };
}
