# openclaw — wraps the UPSTREAM-PUBLISHED npm artifact instead of the nixpkgs source build.
#
# Why not pkgs.openclaw / pkgs-unstable.openclaw (nixpkgs source build):
#   1. **Control UI is broken in the nixpkgs build**: the derivation runs `pnpm build` and
#      `pnpm ui:build` as separate phases minutes apart; each embeds its own wall-clock buildId
#      (`dist/build-info.json` vs the stamp in `dist/control-ui/index.html`). The gateway
#      requires them to match and refuses with "Stale Control UI assets … Reinstall OpenClaw"
#      otherwise — a mismatch EVERY source build produces (and the fallback stamp formats even
#      differ: UI omits the year prefix). The published npm artifact carries ONE consistent
#      release buildId in both places, so the UI works.
#   2. openclaw is insecure-marked in nixpkgs (knownVulnerabilities) ⇒ Hydra skips it ⇒ NO
#      binary cache ⇒ multi-hour source builds on every version bump. The npm artifact is
#      prebuilt (dontNpmBuild); only the dependency set is fetched.
#
# Trade-off: trusts upstream's npm-published artifact (the canonical distribution, MIT) instead
# of rebuilding from pinned source. The tarball ships NO package-lock.json, so the deps FOD pins
# the semver-resolved set BY HASH; transitive drift would surface as a hash mismatch on a cold
# rebuild — regenerate the hash then (same flow as nix-hashes skill).
#
# The published tarball ships NO package-lock.json and buildNpmPackage's fetchNpmDeps
# (prefetch-npm-deps, lockfile-driven) hard-requires one — so we vendor a prod-only lockfile
# GENERATED from the published package.json (npm install --package-lock-only --omit=dev
# --legacy-peer-deps; legacy-peer-deps because upstream's pnpm workspace has a peer conflict
# npm refuses: @mistralai/mistralai via @openclaw/ai). The vendored lock also makes the deps FOD
# deterministic (no semver drift). prefetch-npm-deps resolves purely from the lockfile, so the
# hash is EXPECTED to be platform-independent; if a darwin build ever reports a mismatch,
# split npmDepsHash per system (fakeHash → build on mini → paste `got:`).
#
# Bumping version: change `version`, refresh src hash (`nix hash file <tgz>` after
# `curl -sLO https://registry.npmjs.org/openclaw/-/openclaw-<ver>.tgz`), regenerate the
# vendored lockfile (same npm command, new package.json), refresh npmDepsHash (fakeHash flow).
{
  inputs,
  lib,
  ...
}:
let
  version = "2026.10.5";

  mkOpenclawNpm =
    { pkgs }:
    pkgs.buildNpmPackage {
      pname = "openclaw";
      inherit version;

      src = pkgs.fetchurl {
        url = "https://registry.npmjs.org/openclaw/-/openclaw-${version}.tgz";
        hash = "sha256-27G9zyNGKS4l9nKCK2qZKMI0kJq+b+4N9fxFVudp1A4=";
      };

      postPatch = ''
        cp ${./openclaw-2026.10.5.package-lock.json} package-lock.json
        chmod u+w package-lock.json
      '';

      npmDepsHash = "sha256-B8Bh57wv790S8o/mJw4tdEcO+5WDWOgNociqhlTh3ZY=";

      npmInstallFlags = [
        "--omit=dev"
        "--legacy-peer-deps"
      ];

      # The vendored lockfile is already prod-only; the prune step would re-resolve devDeps
      # against packuments the deps FOD never fetched (ENOTCACHED) — skip it.
      dontNpmPrune = true;

      # engines: node >=24.16 <25 || >=26.1 — nixpkgs' own openclaw wraps nodejs-slim_24;
      # node 26.11 runs but nags "unsupported Node … truncated text". Prefer the 24 LTS line.
      nodejs = pkgs.nodejs_24;

      # The artifact is prebuilt (dist/ + control-ui in the tarball); never run `npm run build`.
      dontNpmBuild = true;

      nativeBuildInputs = [ pkgs.makeWrapper ];

      postInstall = ''
        # Replace the env-node bin stub with a wrapper pinned to our nodejs (stable runtime,
        # no reliance on ambient PATH).
        rm -f "$out/bin/openclaw"
        makeWrapper ${lib.getExe pkgs.nodejs_24} "$out/bin/openclaw" \
          --add-flags "$out/lib/node_modules/openclaw/openclaw.mjs"
      '';

      meta = {
        description = "Self-hosted, open-source AI assistant/agent (upstream npm artifact)";
        homepage = "https://openclaw.ai";
        license = lib.licenses.mit;
        mainProgram = "openclaw";
      };
    };
in
{
  flake.packages.x86_64-linux.openclaw-npm = mkOpenclawNpm {
    pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
  };

  flake.packages.aarch64-darwin.openclaw-npm = mkOpenclawNpm {
    pkgs = inputs.nixpkgs.legacyPackages.aarch64-darwin;
  };
}
