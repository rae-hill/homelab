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
      nixos.technitium

      ./../_private/aedilis/hardware.nix
      ./../_private/aedilis/security.nix
      ./../_private/aedilis/users.nix
      ./../_private/aedilis/sops.nix
      ./../_private/aedilis/system.nix
      ./../_private/aedilis/programs.nix

      { networking.hostName = "aedilis"; }
    ];
  };
}
