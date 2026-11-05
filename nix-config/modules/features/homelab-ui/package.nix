{
  self,
  config,
  inputs,
  lib,
  ...
}:
let
  c = config.constants;
  svc = c.services.homelab;

  mkHomelabUi =
    {
      pkgs,
      apiBaseUrl,
      basePath ? "/",
      oidcWellKnownUrl ? null,
      oidcClientId ? null,
      idmUrl ? null,
    }:
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
        hash = "sha256-ybqsSNJijqPiFj45uVb92xC+pXXIVwEtuBawSQNxSb8=";
      };

      optionalExport = name: value: if value != null then "export ${name}=\"${value}\"" else "";
    in
    pkgs.stdenv.mkDerivation {
      pname = "homelab-ui";
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
        export PUBLIC_API_BASE_URL="${apiBaseUrl}"
        export PUBLIC_BASE_PATH="${basePath}"
        ${optionalExport "PUBLIC_OIDC_WELL_KNOWN_URL" oidcWellKnownUrl}
        ${optionalExport "PUBLIC_OIDC_CLIENT_ID" oidcClientId}
        ${optionalExport "PUBLIC_IDM_URL" idmUrl}
        yarn workspace homelab-frontend build
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        mkdir -p $out
        cp -r packages/homelab-frontend/dist/* $out/
        runHook postInstall
      '';
    };
in
{
  flake.packages.x86_64-linux.homelab-ui = mkHomelabUi {
    pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
    apiBaseUrl = svc.url;
    oidcWellKnownUrl = svc.oidcEndpoint;
    oidcClientId = svc.clientId;
    idmUrl = c.idm.url;
  };

  flake.packages.aarch64-linux.homelab-ui = mkHomelabUi {
    pkgs = inputs.nixpkgs.legacyPackages.aarch64-linux;
    apiBaseUrl = "https://praeconinus.neko-bicolor.ts.net/api";
    basePath = "/ui";
  };
}
