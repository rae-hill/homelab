# proton-mail-mcp — Nix package for the first-party Proton Mail MCP server (phase 2).
#
# Mirrors features/homelab-api/package.nix: nix-filter over the monorepo → fetchYarnBerryDeps
# (shared lockfile ⇒ SAME hash as homelab-api/homelab-ui) → rolldown bundle → nodejs wrapper.
# Exposed for aarch64-darwin only (mini is the sole consumer; spawned by OpenClaw's
# mcp.servers.protonmail — see features/openclaw/service.nix).
#
# NOTE: the yarn offline cache FOD is platform-neutral across x86_64/aarch64-linux (single
# shared hash historically). If the aarch64-darwin build on mini reports a hash mismatch,
# refresh per .opencode/skills/nix-hashes (fakeHash → build on mini → paste `got:`).
{
  self,
  inputs,
  ...
}:
let
  mkProtonMailMcp =
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
        hash = "sha256-qVDumxrjcdoORTq1Q0HooA0levjmDwsMsacZOeFokjk=";
      };
    in
    pkgs.stdenv.mkDerivation {
      pname = "proton-mail-mcp";
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
        yarn workspace proton-mail-mcp build
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p $out/lib $out/bin

        cp -r packages/proton-mail-mcp/dist/bundle $out/lib/bundle

        cat > $out/bin/proton-mail-mcp <<EOF
        #!/bin/sh
        exec ${pkgs.nodejs_26}/bin/node $out/lib/bundle/main.js "\$@"
        EOF
        chmod +x $out/bin/proton-mail-mcp
        runHook postInstall
      '';
    };
in
{
  flake.packages.aarch64-darwin.proton-mail-mcp = mkProtonMailMcp {
    pkgs = inputs.nixpkgs.legacyPackages.aarch64-darwin;
  };
}
