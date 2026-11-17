{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
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
      nixos.homelab-service-dns-host
      nixos.technitium-aedilis

      ./hardware.nix
      ./security.nix
      ./users.nix
      ./sops.nix
      ./system.nix
      ./programs.nix

      { networking.hostName = "aedilis"; }
    ];
  };
}
