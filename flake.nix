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
          (inputs.import-tree ./nix-config/modules)
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

              packages = with pkgs; [
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
              ];
              commands = [
                {
                  name = "e2e";
                  help = "Runs homelab-e2e-tests";
                  command = ''
                    #!/usr/bin/env bash
                    set -uo pipefail

                    # TODO: capture specific test files to run
                    # files=$("$@")

                    port=54328
                    origin="http://localhost:$port"

                    server_pid=""

                    cleanup() {
                      local exit_code=$?
                      trap - EXIT INT TERM 
                      if [[ -n "$server_pid" ]] && kill -0 "$server_pid" 2>/dev/null; then
                        kill "$server_pid"
                        wait "$server_pid"
                      fi
                      exit "$exit_code"
                    }

                    trap cleanup EXIT
                    trap 'exit 130' INT
                    trap 'exit 143' TERM

                    export HOMELAB_ORIGIN_URL=$origin
                    export PORT=$port

                    export E2E_BASE_URL=$origin

                    # build server
                    yarn workspace homelab-server build

                    export HOMELAB_COMMIT_HASH=$(git rev-parse HEAD)

                    # start dev server in background - saving logs to dump file
                    yarn workspace homelab-server serve:test > .e2e-log-dump.txt 2>&1 &

                    server_pid=$!

                    echo "Started: $server_pid"

                    for _ in {1..30}; do
                      curl -sf $origin/status/health >/dev/null 2>&1 && break
                      sleep 0.5
                    done

                    # Run e2e tests
                    yarn workspace homelab-e2e-tests test:e2e 
                    exit $?
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
