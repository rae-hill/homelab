{ config, lib, ... }@topLevel:
let
  c = config.constants;
  unix = c.unix;

  # idm_admin login name used for all privileged kanidm CLI calls.
  idmAdmin = "idm_admin";
in
{
  # POSIX-enablement for Kanidm groups/persons. Runs on augustus (the Kanidm
  # authority). `kanidm-provision` (used by services.kanidm.provision) can
  # create groups/persons and manage membership, but it CANNOT set POSIX
  # attributes (gidnumber, shell) — those must be set via the `kanidm` CLI.
  # This oneshot logs in as idm_admin non-interactively (KANIDM_PASSWORD) and
  # idempotently POSIX-enables the configured groups and persons after the
  # declarative provisioning step has run.
  #
  # NOTE: the per-account UNIX *password* (`kanidm person posix set-password`)
  # is strictly interactive (double-entry TTY prompt) and is NOT set here — it
  # is a one-time manual operator step. See docs/kanidm-unix-users-plan.md.
  flake.modules.nixos.kanidm-posix =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.kanidm;

      kanidm = "${cfg.package}/bin/kanidm";

      groupLines = lib.concatMapStringsSep "\n" (
        g: ''ensure_group_posix "${g.name}" "${toString g.gidnumber}"''
      ) (lib.attrValues unix.groups);

      personLines = lib.concatMapStringsSep "\n" (
        p: ''ensure_person_posix "${p.name}" "${toString p.gidnumber}" "${p.shell}"''
      ) (lib.attrValues unix.persons);

      posixScript = topLevel.config.constants.shell.mkScript pkgs {
        name = "kanidm-posix-provision";
        runtimeInputs = [ cfg.package ];
        text = ''
          set -euo pipefail

          # Private, ephemeral token cache (systemd StateDirectory). Keeps the
          # idm_admin session token off the default root home.
          export HOME="$STATE_DIRECTORY"
          export XDG_CACHE_HOME="$STATE_DIRECTORY/cache"
          mkdir -p "$XDG_CACHE_HOME"

          # Wait for the server to answer over its origin URL (fronted by Caddy)
          # before attempting to authenticate. Gives up after ~60s.
          count=0
          until ${kanidm} self whoami --name anonymous >/dev/null 2>&1 \
            || ${kanidm} version >/dev/null 2>&1; do
            count=$((count + 1))
            if [ "$count" -ge 30 ]; then
              echo "kanidm-posix: server not reachable after 60s, giving up" >&2
              exit 1
            fi
            sleep 2
          done

          KANIDM_PASSWORD="$(cat "$IDM_ADMIN_PASSWORD_FILE")"
          export KANIDM_PASSWORD

          # Non-interactive login as idm_admin (reads KANIDM_PASSWORD from env).
          ${kanidm} login -D "${idmAdmin}"

          # POSIX-enable a group with an explicit gidnumber. Idempotent: re-running
          # `group posix set` is a no-op when already set to the same value.
          ensure_group_posix() {
            local name="$1" gid="$2"
            echo "kanidm-posix: enabling POSIX on group $name (gid $gid)"
            ${kanidm} group posix set --name "${idmAdmin}" "$name" --gidnumber "$gid"
          }

          # POSIX-enable a person with an explicit gidnumber (== uid) and shell.
          ensure_person_posix() {
            local name="$1" gid="$2" shell="$3"
            echo "kanidm-posix: enabling POSIX on person $name (uid/gid $gid, shell $shell)"
            ${kanidm} person posix set --name "${idmAdmin}" "$name" \
              --gidnumber "$gid" --shell "$shell"
          }

          ${groupLines}
          ${personLines}

          # Drop the session token; the cache dir is ephemeral anyway.
          ${kanidm} logout --name "${idmAdmin}" || true

          echo "kanidm-posix: provisioning complete"
        '';
      };
    in
    {
      # Expose the built script so the top-level ShellCheck gate (shellcheck.nix)
      # can harvest it from the augustus evaluation, mirroring the
      # technitium-provisioning pattern.
      options.services.kanidm-posix._lintScript = lib.mkOption {
        type = lib.types.package;
        internal = true;
        description = "Internal: the POSIX-provision script package, for the ShellCheck gate.";
      };

      config = {
        services.kanidm-posix._lintScript = posixScript;

        systemd.services.kanidm-posix-provision = {
          description = "Kanidm POSIX enablement (gidnumber/shell) for unix groups + persons";
          # Run after the server is up and after the declarative provisioning
          # step (kanidm.service postStart) has created the groups/persons. The
          # CLI logs in over the public origin URL, which is fronted by Caddy, so
          # order after caddy + network-online too.
          after = [
            "kanidm.service"
            "caddy.service"
            "network-online.target"
          ];
          wants = [ "network-online.target" ];
          requires = [ "kanidm.service" ];
          wantedBy = [ "multi-user.target" ];

          serviceConfig = {
            Type = "oneshot";
            User = "root";
            ExecStart = lib.getExe posixScript;
            StateDirectory = "kanidm-posix-provision";
            StateDirectoryMode = "0700";
            Environment = [
              "IDM_ADMIN_PASSWORD_FILE=${config.sops.secrets.kanidm_idm_admin_passphrase.path}"
            ];
          };
        };
      };
    };

  # Register the POSIX-provision script into the ShellCheck gate by harvesting
  # the package built inside the augustus NixOS evaluation.
  flake.lintedShellScripts =
    let
      augustus = topLevel.config.flake.nixosConfigurations.augustus or null;
    in
    lib.optionals (augustus != null) [
      (_pkgs: augustus.config.services.kanidm-posix._lintScript)
    ];
}
