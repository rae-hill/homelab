{ lib, ... }:
{
  # Shared ShellCheck-as-Nix-test tooling.
  #
  # `writeShellApplication` already runs ShellCheck in its build `checkPhase`, but that
  # only fires when the derivation is actually BUILT — a bare `nix flake check` evaluates
  # NixOS configs without building their scripts, so the lint never runs. This module
  # closes that gap with:
  #
  #   constants.shell.mkScript pkgs { … }       — writeShellApplication wrapper (lint on build)
  #   constants.shell.checkScriptText pkgs { … } — lint a raw script TEXT (systemd `script =`)
  #   flake.lintedShellScripts                   — registry of specs the check builds
  #   checks.shellcheck (see checks/shellcheck.nix) — forces the registry to build => lint runs
  #
  # Registry specs are FUNCTIONS of `pkgs` returning a derivation, so the per-system
  # check applies its own system's pkgs. Register a script's lint by appending a spec:
  #
  #   flake.lintedShellScripts = [
  #     (pkgs: config.constants.shell.mkScript pkgs { name = "foo"; text = "…"; })
  #   ];
  options.flake.lintedShellScripts = lib.mkOption {
    type = lib.types.listOf (lib.types.functionTo lib.types.package);
    default = [ ];
    description = ''
      Registry of shell-script lint specs. Each entry is a function `pkgs -> derivation`
      that, when built, runs ShellCheck (either a writeShellApplication whose checkPhase
      lints, or a checkScriptText lint derivation). The per-system `checks.shellcheck`
      aggregate builds every entry so `nix flake check` exercises ShellCheck on all of
      them without having to build whole hosts.
    '';
  };

  config.constants.shell = {
    # Drop-in for pkgs.writeShellApplication. Identical behaviour (strict bashOptions +
    # ShellCheck in checkPhase); adds a `_isLintedShell` passthru tag for discovery and
    # standardises the call site. Pass `excludeShellChecks`/`runtimeInputs`/etc. through.
    mkScript =
      pkgs: args:
      (pkgs.writeShellApplication args).overrideAttrs (old: {
        passthru = (old.passthru or { }) // {
          _isLintedShell = true;
        };
      });

    # Lint a raw script TEXT without turning it into a packaged application. Useful for
    # systemd `script = ''…''` blocks and inline `ExecStart` shell: build this derivation
    # (it emits an empty $out on success, fails the build on any ShellCheck finding) to
    # lint the exact text the unit will run. Register it in flake.lintedShellScripts.
    checkScriptText =
      pkgs:
      {
        name,
        text,
        shell ? "bash",
        excludeShellChecks ? [ ],
      }:
      pkgs.runCommand "shellcheck-${name}"
        {
          nativeBuildInputs = [ pkgs.shellcheck ];
          passthru._isLintedShell = true;
        }
        ''
          cat > script <<'SHELLCHECK_EOF'
          #!${pkgs.runtimeShell}
          ${text}
          SHELLCHECK_EOF
          shellcheck \
            ${
              lib.optionalString (
                excludeShellChecks != [ ]
              ) "--exclude ${lib.concatStringsSep "," excludeShellChecks}"
            } \
            --shell=${shell} script
          touch $out
        '';
  };
}
