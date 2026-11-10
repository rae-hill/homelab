# resume-site — the built resume SPA (packages/resume), served loopback-only on
# augustus for homelab-api's headless PDF printing (RESUME_SITE_URL). Mirrors the
# homelab-ui derivation: same monorepo src filter, same shared fetchYarnBerryDeps
# hash (one yarn.lock for the whole repo — refresh together, see nix-hashes skill).
{
  self,
  inputs,
  ...
}:
let
  mkResumeSite =
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
      pname = "resume-site";
      version = "0.0.1";

      inherit src yarnOfflineCache missingHashes;

      nativeBuildInputs = [
        pkgs.nodejs_26
        pkgs.yarn-berry
        fetcher.yarnBerryConfigHook
      ];

      YARN_ENABLE_SCRIPTS = "0";

      buildPhase = ''
        runHook preBuild
        yarn workspace resume build
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p $out
        cp -r packages/resume/dist/* $out/
        runHook postInstall
      '';
    };
in
{
  flake.packages.x86_64-linux.resume-site = mkResumeSite {
    pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
  };
}
