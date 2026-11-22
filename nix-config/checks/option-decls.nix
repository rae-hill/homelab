{ config, lib, ... }:
{
  # Force every option declaration of every host configuration.
  #
  # A malformed option declaration — e.g. a partially applied curried lib
  # function (`lib.mkPackageOption "name" { ... }`) that leaves a lambda where
  # an option attrset must be — sits inert until something READS the option:
  # `nix flake check` only forces each host's `config.system.build.toplevel`,
  # whose dependency graph never touches unread options. That is how the
  # `services.homelab-api.pkg` bug survived for months
  # (docs/mkpackageoption-lambda-bug.md).
  #
  # This check closes that hole: `lib.collect lib.isOption` walks the visible
  # `options` tree and the isOption predicate forces `_type` on every node —
  # forcing an entry makes the module system merge that option's declarations,
  # which is exactly where a malformed one throws ("An option declaration for
  # ... has type 'lambda' rather than an attribute set"). Each collected
  # option's `type.name` is forced as well (the doc's one-liner guard), which
  # additionally catches declarations that merge but carry no usable type.
  #
  # Scope: the visible options tree per host. Sub-options INSIDE submodule
  # types (e.g. services.homelab-api.apiKeys.<name>.apiKeyFile) are merged by
  # the submodule machinery separately and are covered only insofar as the
  # host's toplevel eval reads them.
  #
  # All work happens at eval time (the runCommand script interpolates the
  # forced summary); the derivation itself is a trivial marker. Defined only
  # for x86_64-linux (the shellcheck.nix convention) — the module system is
  # architecture-independent, so aarch64-darwin would just pay the same eval
  # twice.
  perSystem =
    { pkgs, system, ... }:
    let
      hosts = (config.flake.nixosConfigurations or { }) // (config.flake.darwinConfigurations or { });

      perHost = lib.mapAttrsToList (
        hostName: hostCfg:
        let
          collected = lib.collect lib.isOption hostCfg.options;
          # One string per option; deepSeq forces their contents, hence every
          # option's merged `type.name`, hence every declaration merge.
          lines = map (opt: "${lib.showOption opt.loc} = ${opt.type.name}") collected;
          count = builtins.deepSeq lines (builtins.length lines);
        in
        "${hostName}=${toString count}"
      ) hosts;

      summary = builtins.concatStringsSep " " perHost;
    in
    {
      checks = lib.optionalAttrs (system == "x86_64-linux") {
        option-decls = pkgs.runCommand "option-decls-forced" { } ''
          echo "forced option declarations: ${summary}" > $out
        '';
      };
    };
}
