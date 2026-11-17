{ inputs, config, ... }:
let
  nixos = inputs.self.modules.nixos;
in
{
  # Host-local flake-parts modules (system-configs isn't import-tree'd, so the
  # bespoke host files register flake.modules.nixos.host-augustus-* via these
  # imports and are referenced below like any shared module).
  imports = [
    ./hardware.nix
    ./filesystems.nix
    ./security.nix
    ./system.nix
    ./programs.nix
  ];

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
      nixos.users-human
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

      nixos.host-augustus-hardware
      nixos.host-augustus-filesystems
      nixos.host-augustus-security
      nixos.host-augustus-system
      nixos.host-augustus-programs
      ./sops.nix

      { networking.hostName = "augustus"; }
    ];
  };
}
