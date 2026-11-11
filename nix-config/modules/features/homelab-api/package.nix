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
        hash = "sha256-ZsQLgstpYPqrf6M4PL4aK5AC5wLJL2mRewZ3ooJrYZU=";
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
        pkgs.patchelf
      ];

      # Runtime libraries sharp's prebuilt native binaries link against
      # (glibc + libstdc++); patched into their RPATH below (doc 08 T24).
      buildInputs = [
        pkgs.glibc
        pkgs.stdenv.cc.cc.lib
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

        # --- sharp runtime closure (doc 08 T21/T24, OQ4) -----------------------
        # @turbodocx/html-to-docx lazily `require("sharp")`s (kept EXTERNAL by
        # the rolldown bundle), so node must resolve it upward from
        # $out/lib/bundle/main.js. Copy sharp wholesale, its hoisted pure-JS
        # deps, and the build-platform @img binary packages — depending on the
        # hoist, those live at root node_modules/@img OR nested under
        # sharp/node_modules/@img (the wholesale copy keeps the nested form;
        # the glob below adds the hoisted form; node resolves nested-first).
        # The prebuilt ELFs are generic-linux binaries whose NEEDED libs
        # (glibc, libstdc++, libgcc_s) don't exist at /lib* on NixOS, so
        # patchelf their RPATH below. Without all of this the library's
        # try/catch silently degrades to native-SVG embedding at runtime on
        # augustus.
        mkdir -p $out/lib/bundle/node_modules/@img
        cp -rL node_modules/sharp $out/lib/bundle/node_modules/sharp
        for dep in $(node -p "Object.keys(require('./node_modules/sharp/package.json').dependencies).join(' ')"); do
          if [ -d "$out/lib/bundle/node_modules/sharp/node_modules/$dep" ]; then
            continue # already copied inside sharp's nested tree
          fi
          mkdir -p "$(dirname "$out/lib/bundle/node_modules/$dep")"
          cp -rL "node_modules/$dep" "$out/lib/bundle/node_modules/$dep"
        done
        for pkg in node_modules/@img/sharp-*; do
          [ -d "$pkg" ] || continue # optional deps: only the build platform is present
          cp -rL "$pkg" "$out/lib/bundle/node_modules/@img/"
        done

        # Patch the prebuilt shared objects for NixOS: they are generic-linux
        # ELFs whose NEEDED libs (glibc, libstdc++, libgcc_s) don't exist at
        # /lib* on NixOS. Shared objects have no .interp section (node's own
        # loader provides the interpreter), so only RPATH needs fixing —
        # PRESERVING the $ORIGIN chain that locates the sibling libvips.
        # Without this the library's try/catch silently degrades to native-SVG
        # embedding at runtime on augustus.
        syslibs="${pkgs.glibc}/lib:${pkgs.stdenv.cc.cc.lib}/lib"
        while read -r libvips; do
          patchelf --set-rpath '$ORIGIN:'"$syslibs" "$libvips"
        done < <(find $out/lib/bundle/node_modules -type f -name "libvips-cpp.so*")
        while read -r addon; do
          patchelf --set-rpath '$ORIGIN/../../sharp-libvips-linux-x64/lib:$ORIGIN/../../sharp-libvips-linux-arm64/lib:'"$syslibs" \
            "$addon"
        done < <(find $out/lib/bundle/node_modules -type f -name "*.node")

        # Fail the BUILD if the closure cannot load and exercise sharp, rather
        # than degrading silently on the server.
        (cd $out/lib/bundle && node -e "require('./node_modules/sharp')({create:{width:1,height:1,channels:3,background:'red'}}).png().toBuffer().then(()=>console.log('sharp runtime closure OK')).catch((e)=>{console.error(e);process.exit(1)})")

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
