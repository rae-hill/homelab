{ config, lib, ... }:
{
  # Aggregate ShellCheck gate. Builds every spec registered in
  # `flake.lintedShellScripts` with the per-system pkgs; building a writeShellApplication
  # (or checkScriptText) runs its ShellCheck checkPhase, so this check makes
  # `nix flake check` actually lint all registered scripts — without building whole hosts.
  #
  # Linux-only: ShellCheck's checkPhase is skipped where its compiler isn't bootstrappable
  # (e.g. aarch64-darwin), which would make a "pass" a silent no-op. Scope to x86_64-linux
  # so the gate is meaningful.
  perSystem =
    {
      pkgs,
      system,
      ...
    }:
    let
      specs = config.flake.lintedShellScripts;
      builtScripts = map (spec: spec pkgs) specs;
    in
    {
      checks = lib.optionalAttrs (system == "x86_64-linux") {
        # Depending on every built script forces them to build => each ShellCheck
        # checkPhase runs. The symlinkJoin is just a convenient way to reference them all
        # as build inputs; the empty success marker is the check result.
        shellcheck =
          pkgs.runCommand "shellcheck-all"
            {
              nativeBuildInputs = builtScripts;
            }
            ''
              echo "shellcheck: linted ${toString (builtins.length builtScripts)} script(s)"
              touch $out
            '';
      };
    };
}
