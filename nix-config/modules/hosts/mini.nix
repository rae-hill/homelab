{ inputs, config, ... }:
let
  darwin = inputs.self.modules.darwin;
in
{
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
      darwin.homebrew
      darwin.homelab-service-apphost
      darwin.mini-jellyfin
      darwin.openclaw

      ./../_private/mini/sops.nix
      ./../_private/mini/programs.nix

      { networking.hostName = "mini"; }
    ];
  };
}
