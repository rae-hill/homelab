{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
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
      nixos.step-ca
      nixos.homelab-service-apphost
      nixos.cicero-observability

      ./../_private/cicero/hardware.nix
      ./../_private/cicero/security.nix
      ./../_private/cicero/users.nix
      ./../_private/cicero/sops.nix
      ./../_private/cicero/system.nix
      ./../_private/cicero/programs.nix

      { networking.hostName = "cicero"; }
    ];
  };
}
