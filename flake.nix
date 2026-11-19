{
  description = "Homelab monorepo with NixOS configurations";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    nixpkgs-unstable.url = "github:nixos/nixpkgs/nixos-unstable";

    nix-darwin.url = "github:nix-darwin/nix-darwin/nix-darwin-26.05";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";

    home-manager.url = "github:nix-community/home-manager/release-26.05";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";

    sops-nix.url = "github:Mic92/sops-nix";
    sops-nix.inputs.nixpkgs.follows = "nixpkgs";

    catppuccin.url = "github:catppuccin/nix/release-26.05";

    nixvim.url = "github:nix-community/nixvim/nixos-26.05";

    quadlet-nix.url = "github:SEIAROTg/quadlet-nix";

    nix-minecraft.url = "github:Infinidoge/nix-minecraft";

    flake-parts.url = "github:hercules-ci/flake-parts";

    devshell.url = "github:numtide/devshell";

    import-tree.url = "github:vic/import-tree";

    nix-filter.url = "github:numtide/nix-filter";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-unstable,
      catppuccin,
      nixvim,
      home-manager,
      sops-nix,
      nix-darwin,
      quadlet-nix,
      nix-minecraft,
      flake-parts,
      devshell,
      import-tree,
      ...
    }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } (
      { config, ... }:
      {
        imports = [
          inputs.devshell.flakeModule

          ./nix-config/constants.nix
          ./nix-config/service-registry.nix

          (inputs.import-tree ./nix-config/modules)
          (inputs.import-tree ./nix-config/lib)
          (inputs.import-tree ./nix-config/checks)
          (inputs.import-tree ./nix-config/home-configs)

          # System configs are imported explicitly per host: each directory mixes
          # the flake-parts host definition (default.nix) with plain NixOS/darwin
          # modules (hardware.nix, sops.nix, security.nix, ...) that import-tree
          # would otherwise try to evaluate as flake-parts modules.
          ./nix-config/system-configs/aedilis/default.nix
          ./nix-config/system-configs/augustus/default.nix
          ./nix-config/system-configs/cicero/default.nix
          ./nix-config/system-configs/mini/default.nix
          ./nix-config/system-configs/nixos/default.nix
          ./nix-config/system-configs/praeconinus/default.nix
        ];

        # Lint repo shell scripts through the ShellCheck gate: `nix flake check` /
        # `nix build .#checks.x86_64-linux.shellcheck` builds these specs, which
        # run ShellCheck over the exact script text.
        # - scripts/e2e.sh: the devshell `e2e` command execs the same file.
        # - .husky/pre-push: the flake-eval gate moved out of lint-staged's
        #   stash/restore window (see docs/nix-store-poisoning/README.md);
        #   husky executes hook files with sh.
        flake.lintedShellScripts = [
          (
            pkgs:
            config.constants.shell.checkScriptText pkgs {
              name = "e2e";
              text = builtins.readFile ./scripts/e2e.sh;
            }
          )
          (
            pkgs:
            config.constants.shell.checkScriptText pkgs {
              name = "husky-pre-push";
              text = builtins.readFile ./.husky/pre-push;
              shell = "sh";
            }
          )
        ];

        perSystem =
          { pkgs, system, ... }:
          let
            dprintPlugins = with pkgs.dprint-plugins; [
              dprint-plugin-typescript
              dprint-plugin-json
              dprint-plugin-markdown
              dprint-plugin-toml
              g-plane-malva
              g-plane-markup_fmt
              g-plane-pretty_yaml
            ];
            pluginPaths = map (p: "${p}/plugin.wasm") dprintPlugins;
            pluginArgs = builtins.concatStringsSep " " pluginPaths;
          in
          {
            _module.args.pkgs = import inputs.nixpkgs {
              inherit system;
              config.allowUnfree = true;
            };

            formatter = pkgs.dprint;

            # Expose the pinned nixfmt so git hooks / CI format Nix with the SAME
            # version as the devshell and the nixvim editor config (deterministic).
            # Invoke via `nix run .#nixfmt`.
            packages.nixfmt = pkgs.nixfmt;

            checks = {
              formatting =
                pkgs.runCommand "check-formatting"
                  {
                    buildInputs = [ pkgs.dprint ];
                    src = ./.;
                  }
                  ''
                    cd $src
                    export DPRINT_CACHE_DIR=${"\${DPRINT_CACHE_DIR:-$TMPDIR/dprint-cache}"}
                    ${pkgs.dprint}/bin/dprint check --allow-no-files --plugins ${pluginArgs}
                    touch $out
                  '';
            };

            devshells.default = {

              packages =
                (with pkgs; [
                  # NixOS tooling
                  sops
                  age
                  nixfmt
                  # TypeScript/Node development
                  dprint
                  yarn-berry
                  nodejs_26
                  yarn-berry_4-fetcher.yarn-berry-fetcher
                  typescript
                  typescript-language-server
                  python3
                ])
                ++ [
                  # SecretSpec from unstable — 26.05 carries a stale 0.10.1;
                  # repos/secretspec is vendored at the unstable tag (v0.21.1).
                  # See docs/secretspec-migration-plan.md.
                  inputs.nixpkgs-unstable.legacyPackages.${system}.secretspec
                ];
              env = [
                {
                  name = "EDITOR";
                  value = "nvim";
                }
                {
                  name = "DPRINT_CACHE_DIR";
                  value = "/home/jacob/.cache/dprint";
                }
                {
                  name = "CHROME_EXECUTABLE";
                  value = "${pkgs.google-chrome}/bin/google-chrome";
                }
                # NOTE: TYPST_ASSETS_DIR is deliberately NOT exported shell-wide.
                # ${self} would freeze the typst assets into a read-only store snapshot
                # (stale on template edits). Consumers resolve the live worktree assets
                # themselves: scripts/e2e.sh exports it from repo_root, the gated vitest
                # live-render test defaults to the repo-relative assets dir, and
                # production gets it from the homelab-api systemd unit
                # (cover-letter-generator doc 05 §D).
                {
                  # Same static print-font bundle the homelab-api unit exports for
                  # headless chrome (features/homelab-api/systemd-service.nix →
                  # FONTCONFIG_FILE): Carlito/Caladea/Liberation so e2e resume
                  # printing resolves fonts exactly like production. The generated
                  # conf still includes ~/.nix-profile and /etc/fonts/conf.d, so
                  # host fonts remain visible to everything else in the devshell.
                  name = "FONTCONFIG_FILE";
                  value = toString (
                    pkgs.makeFontsConf {
                      fontDirectories = [
                        pkgs.carlito
                        pkgs.caladea
                        pkgs.liberation_ttf
                      ];
                    }
                  );
                }
              ];
              commands = [
                {
                  name = "e2e";
                  help = "Runs homelab-e2e-tests against a freshly bundled server; args pass through to vitest (test-file filters)";
                  # The script body lives in scripts/e2e.sh (linted via
                  # flake.lintedShellScripts above; CI runs the file directly).
                  command = ''
                    exec "${self}/scripts/e2e.sh" "$@"
                  '';
                }
                {
                  name = "fmt";
                  help = "Format code with dprint using Nix store plugins";
                  # `--` is required: dprint's `--plugins` takes multiple values and
                  # greedily swallows trailing file args (e.g. `fmt .`) as plugin
                  # paths without it.
                  command = "${pkgs.dprint}/bin/dprint fmt --plugins ${pluginArgs} --";
                }
                {
                  name = "secrets-check";
                  help = "Verify secretspec resolution: secrets-check <host-profile> [--scope <svc>] (agents must pass --reason)";
                  # Manifest lives at nix-config/secretspec.toml (root manifest,
                  # profile = host). See docs/secretspec-migration-plan.md.
                  command = ''
                    profile=$1; shift
                    cd "$PRJ_ROOT/nix-config" && exec secretspec check --profile "$profile" "$@"
                  '';
                }
                {
                  name = "update-missing-hashes";
                  help = "Regenerate missing-hashes.json for Nix yarn-berry builds";
                  command = "${pkgs.yarn-berry_4-fetcher.yarn-berry-fetcher}/bin/yarn-berry-fetcher missing-hashes yarn.lock 2>/dev/null | grep -v '^CacheKey\\|^Success\\|^$' > missing-hashes.json";
                }
                {
                  name = "remote-build-cicero";
                  help = "Rebuild Cicero over ssh";
                  command = "nixos-rebuild --target-host jacob@cicero.plato-splunk.media switch --flake .#cicero --sudo --ask-sudo-password";
                }
                {
                  name = "remote-build-cicero-backup";
                  help = "Rebuild Cicero over ssh";
                  command = "nixos-rebuild --target-host jacob@cicero.neko-bicolor.ts.net switch --flake .#cicero --sudo --ask-sudo-password";
                }
                {
                  name = "rollback-cicero";
                  help = "Rellback Cicero one generation over ssh";
                  command = "nixos-rebuild --target-host jacob@cicero.neko-bicolor.ts.net switch --rollback --flake .#cicero --sudo --ask-sudo-password";
                }
                {
                  name = "remote-build-augustus";
                  help = "Rebuild Augustus over ssh";
                  command = "nixos-rebuild --target-host jacob@augustus.plato-splunk.media switch --flake .#augustus --sudo --ask-sudo-password";
                }
                {
                  name = "remote-build-praeconinus";
                  help = "Rebuild Praeconinus over ssh";
                  command = "nixos-rebuild --target-host jacob@praeconinus.neko-bicolor.ts.net switch --flake .#praeconinus --sudo --ask-sudo-password";
                }
                {
                  name = "remote-build-aedilis";
                  help = "Rebuild Aedilis over ssh";
                  command = "nixos-rebuild --target-host admin@aedilis.neko-bicolor.ts.net switch --flake .#aedilis --sudo --ask-sudo-password";
                }
              ];
            };
          };

        systems = [
          "x86_64-linux"
          "aarch64-darwin"
        ];
      }
    );
}
