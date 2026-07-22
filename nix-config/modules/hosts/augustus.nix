{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
  flake.nixosConfigurations.augustus = inputs.nixpkgs.lib.nixosSystem {
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
      inputs.quadlet-nix.nixosModules.quadlet
      inputs.nix-minecraft.nixosModules.minecraft-servers
      { nixpkgs.overlays = [ inputs.nix-minecraft.overlay ]; }

      nixos.system-base
      nixos.caddy
      nixos.acme
      nixos.postgres
      nixos.restic
      nixos.kanidm
      nixos.home-assistant
      nixos.minecraft
      nixos.podman-quadlet
      nixos.radius
      nixos.openwebui
      nixos.planka
      nixos.it-tools
      nixos.apprise
      nixos.habitsync
      nixos.failure-notifs
      nixos.prometheus
      nixos.loki
      nixos.alloy
      nixos.tempo
      nixos.grafana
      nixos.unpoller
      nixos.homelab-api
      nixos.homelab-kanidm
      nixos.homelab-ui

      ./../_private/augustus/hardware.nix
      ./../_private/augustus/filesystems.nix
      ./../_private/augustus/security.nix
      ./../_private/augustus/users.nix
      ./../_private/augustus/sops.nix
      ./../_private/augustus/system.nix
      ./../_private/augustus/programs.nix

      { networking.hostName = "augustus"; }
    ];
  };
}
