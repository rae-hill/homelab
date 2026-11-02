{
  self,
  config,
  inputs,
  lib,
  ...
}:
let
  mkHomelabApi =
    { pkgs }:
    let
      filter = inputs.nix-filter.lib;
      fetcher = pkgs.yarn-berry_4-fetcher;

      src = filter {
        root = self;
        include = [
          (filter.matchName "package.json")
          (filter.matchName "yarn.lock")
          (filter.matchName ".yarnrc.yml")
          ".yarn/patches"
          (filter.matchName "tsconfig.base.json")
          (filter.inDirectory "packages")
        ];
        exclude = [
          (filter.matchExt "test.ts")
        ];
      };

      missingHashes = "${self}/missing-hashes.json";

      yarnOfflineCache = fetcher.fetchYarnBerryDeps {
        inherit src missingHashes;
        hash = "sha256-3S4lNKpu32PHg64nkTr5w8vK3lZcZCc/WUATjqDTuJs=";
      };
    in
    pkgs.stdenv.mkDerivation {
      pname = "homelab-api";
      version = "0.1.0";

      inherit src yarnOfflineCache missingHashes;

      nativeBuildInputs = [
        pkgs.nodejs_26
        pkgs.yarn-berry
        fetcher.yarnBerryConfigHook
      ];

      YARN_ENABLE_SCRIPTS = "0";

      buildPhase = ''
        runHook preBuild
        yarn workspace homelab-server build
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p $out/lib $out/bin

        cp -r packages/homelab-server/dist/bundle $out/lib/bundle

        cat > $out/bin/homelab-api <<EOF
        #!/bin/sh
        exec ${pkgs.nodejs_26}/bin/node $out/lib/bundle/main.js "\$@"
        EOF
        chmod +x $out/bin/homelab-api
        runHook postInstall
      '';
    };
in
{
  flake.packages.x86_64-linux.homelab-api = mkHomelabApi {
    pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
  };

  flake.packages.aarch64-linux.homelab-api = mkHomelabApi {
    pkgs = inputs.nixpkgs.legacyPackages.aarch64-linux;
  };
}
