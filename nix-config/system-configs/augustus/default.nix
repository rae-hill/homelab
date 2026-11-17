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
      nixos.system-nix-base
      nixos.system-locale
      nixos.system-boot-systemd
      nixos.system-networking
      nixos.system-networking-forwarding
      nixos.system-security-base
      nixos.caddy
      nixos.homelab-service-oidc-host
      nixos.acme
      nixos.postgres
      nixos.desktop-restic
      nixos.kanidm
      nixos.kanidm-posix
      nixos.home-assistant
      nixos.minecraft
      nixos.desktop-virtualization
      nixos.radius
      nixos.openwebui
      nixos.planka
      nixos.it-tools
      nixos.habitsync
      nixos.failure-notifs
      nixos.prometheus
      nixos.loki
      nixos.alloy
      nixos.tempo
      nixos.grafana
      nixos.unpoller
      nixos.homelab-api
      nixos.homelab-ui
      nixos.resume-site
      nixos.technitium-kanidm

      ./hardware.nix
      ./filesystems.nix
      ./security.nix
      ./users.nix
      ./sops.nix
      ./system.nix
      ./programs.nix

      { networking.hostName = "augustus"; }
    ];
  };
}
