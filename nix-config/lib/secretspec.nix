{
  inputs,
  lib,
  config,
  ...
}:
{
  # SecretSpec exec-wrapper helper — the Phase 3+ delivery mechanism
  # (docs/secretspec-migration-plan.md §4.3).
  #
  # No renderer, no reconciliation unit: services are WRAPPED. The wrapper
  # (and its glue script, when names need mapping) lives in the Nix store and
  # carries secret NAMES only; values are resolved at service start:
  #
  #   ExecStart = mkWrapper … → secretspec run --profile <host> --scope <svc>
  #                             -f <store copy of nix-config/secretspec.toml>
  #                             -- <glue?> <target> "$@"
  #
  # - Secrets declared `as_path = true` in the manifest arrive as env vars
  #   whose value is the path to a 0400 temp file living exactly as long as
  #   the wrapped child (`run` deletes them on child exit — units must use
  #   `run`, never `export`, whose as_path temp files persist).
  # - All other secrets arrive as raw env vars (/proc/<pid>/environ is
  #   same-uid+root readable; values never touch argv, journal, or store).
  # - `glueEnv` maps lowercase manifest names (= sops yaml keys) to daemon
  #   env names; values are runtime shell snippets, e.g.
  #   `PUSHOVER_TOKEN_FILE = "$pushover_token"`.
  # - `ageKeyFile` exports SOPS_AGE_KEY_FILE for the interim sops provider (a
  #   PATH, not a value — safe in the store; typically config.sops.age.keyFile,
  #   the same file sops-nix uses). The store-copy manifest is self-contained:
  #   relative sops:// aliases rebase against its dir and the encrypted yamls
  #   travel with the flake. Phase 4 adds the per-service 1Password SA token
  #   via the unit's LoadCredential=/0400 EnvironmentFile= instead.
  # - `run --scope` scrubs out-of-scope secret names from the child env —
  #   glue must not rely on ambient secret env.
  # - The sops provider shells out to the `sops` CLI, so both secretspec and
  #   sops go into runtimeInputs. secretspec must be >= 0.21 (run scope-scrub
  #   + as_path semantics): pass pkgs-unstable.secretspec — nixpkgs 26.05
  #   carries a stale 0.10.1.
  config.constants.secretspec = {
    mkWrapper =
      pkgs:
      {
        name,
        profile,
        scope,
        target,
        glueEnv ? { },
        ageKeyFile ? null,
        secretspec ? pkgs.secretspec,
        sops ? pkgs.sops,
        manifest ? inputs.self + "/nix-config/secretspec.toml",
      }:
      let
        secretspecChecked =
          if lib.versionAtLeast (secretspec.version or "0") "0.21" then
            secretspec
          else
            throw "constants.secretspec.mkWrapper '${name}': secretspec >= 0.21 required (got ${
              secretspec.version or "unknown"
            }); pass pkgs-unstable.secretspec";
        glue =
          if glueEnv == { } then
            target
          else
            config.constants.shell.mkScript pkgs {
              name = "${name}-glue";
              # SC2154: the glue references secretspec-injected env vars that
              # exist only inside `run` — invisible to the static linter.
              excludeShellChecks = [ "SC2154" ];
              text = ''
                set -euo pipefail
                ${lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "export ${k}=\"${v}\"") glueEnv)}
                exec ${lib.getExe target} "$@"
              '';
            };
      in
      config.constants.shell.mkScript pkgs {
        name = name;
        runtimeInputs = [
          secretspecChecked
          sops
        ];
        text = ''
          set -euo pipefail
          ${lib.optionalString (ageKeyFile != null) ''export SOPS_AGE_KEY_FILE="${ageKeyFile}"''}
          exec secretspec run --profile "${profile}" --scope "${scope}" -f "${manifest}" -- ${lib.getExe glue} "$@"
        '';
      };
  };
}
