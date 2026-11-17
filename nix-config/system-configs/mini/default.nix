{ inputs, config, ... }:
let
  darwin = inputs.self.modules.darwin;
in
{
  # Host-local flake-parts modules (system-configs isn't import-tree'd, so the
  # bespoke host file registers flake.modules.darwin.host-mini-programs via
  # this import and is referenced below like any shared module).
  imports = [
    ./programs.nix
  ];

  flake.darwinConfigurations.mini = inputs.nix-darwin.lib.darwinSystem {
    specialArgs = {
      inherit inputs;
      pkgs-unstable = import inputs.nixpkgs-unstable {
        system = "aarch64-darwin";
        config = {
          allowUnfree = true;
          # nixpkgs marks openclaw insecure via meta.knownVulnerabilities ("LLMs parse
          # untrusted content … full system access by default") — inherent to AI agents,
          # consciously accepted; mitigations in docs/openclaw-mini-plan.md §Security.
          # Predicate keys on pname so it survives version bumps (unlike
          # permittedInsecurePackages' exact name-version match).
          allowInsecurePredicate = x: inputs.nixpkgs-unstable.lib.getName x == "openclaw";
        };
      };
    };
    modules = [
      inputs.sops-nix.darwinModules.sops
      inputs.nixvim.nixDarwinModules.nixvim

      darwin.darwin-base
      darwin.nixvim-complete
      darwin.desktop-homebrew
      darwin.homelab-service-apphost
      darwin.mini-jellyfin
      darwin.openclaw

      darwin.host-mini-programs
      ./sops.nix

      { networking.hostName = "mini"; }
    ];
  };
}
