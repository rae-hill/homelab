{ config, lib, ... }@topLevel:
{
  # Systemd failure notifications, delivered DIRECTLY to Pushover.
  #
  # Previously this posted to a local Apprise container
  # (failure-notifs -> Apprise -> Pushover). That indirection was unreliable, so
  # this now calls the Pushover Messages API directly
  # (https://api.pushover.net/1/messages.json), mirroring how Grafana already
  # talks to Pushover (userKey + apiToken). Apprise is no longer involved.
  #
  # Credentials are delivered by the SecretSpec exec wrapper (Phase 3b pilot
  # of docs/secretspec-migration-plan.md §4.3/§7) — see wrappedNotifyScript
  # below; there are no userKeyFile/tokenFile options and no /run/secrets
  # files for this service anymore.
  flake.modules.nixos.failure-notifs =
    {
      config,
      lib,
      pkgs,
      pkgs-unstable ? pkgs,
      ...
    }:
    let
      cfg = config.services.failure-notifs;

      notifyScript = topLevel.config.constants.shell.mkScript pkgs {
        name = "failure-notifs-pushover";
        runtimeInputs = with pkgs; [
          curl
          coreutils
        ];
        text = ''
          set -euo pipefail

          # Populated by systemd when this unit is started via OnFailure= (single
          # triggering unit). Fall back to the generic SERVICE_RESULT/EXIT vars.
          SERVICE_NAME="''${MONITOR_UNIT:-}"
          SERVICE_RESULT="''${MONITOR_SERVICE_RESULT:-''${SERVICE_RESULT:-}}"
          EXIT_CODE="''${MONITOR_EXIT_STATUS:-''${EXIT_STATUS:-}}"

          if [ -z "$SERVICE_NAME" ]; then
            echo "failure-notifs: MONITOR_UNIT not set (not an OnFailure trigger, or"
            echo "failure-notifs: metadata not propagated because multiple units"
            echo "failure-notifs: failed at once). Sending a generic alert."
            SERVICE_NAME="unknown-unit"
          fi
          [ -n "$SERVICE_RESULT" ] || SERVICE_RESULT="unknown"
          [ -n "$EXIT_CODE" ] || EXIT_CODE="unknown"

          USER_KEY="$(cat "$PUSHOVER_USER_KEY_FILE")"
          API_TOKEN="$(cat "$PUSHOVER_TOKEN_FILE")"

          TITLE="${cfg.emoji} ${cfg.titlePrefix}: $SERVICE_NAME"
          MESSAGE="Unit: $SERVICE_NAME
          Result: $SERVICE_RESULT
          Exit status: $EXIT_CODE
          Host: $(uname -n)"

          # --fail-with-body surfaces Pushover's JSON error (e.g. bad token) in logs
          # and makes the unit fail (paging-on-failure is intentional here).
          curl --fail-with-body --silent --show-error \
            --max-time 20 --retry 3 --retry-delay 5 --retry-connrefused \
            --form-string "token=$API_TOKEN" \
            --form-string "user=$USER_KEY" \
            --form-string "title=$TITLE" \
            --form-string "message=$MESSAGE" \
            --form-string "priority=${toString cfg.priority}" \
            https://api.pushover.net/1/messages.json

          echo ""
          echo "failure-notifs: pushover notification sent for $SERVICE_NAME"
        '';
      };

      # SecretSpec exec wrapper (migration plan §4.3 — the Phase 3b pilot,
      # first service cut over from sops-nix delivery). Resolves
      # pushover_user_key/pushover_token — declared as_path = true in
      # system-configs/augustus/secretspec.toml — at service start into 0400
      # temp files that die with the process; the glue maps them onto the
      # script's PUSHOVER_*_FILE env contract, so the script is unchanged.
      # Replaces the former sops.secrets.pushover_* declarations and their
      # /run/secrets files. The sops yaml
      # (system-configs/augustus/secrets/failure-notifs.yaml) remains the
      # interim STORAGE read by the manifest's sops provider until Phase 4
      # flips the chain to the service's 1Password SA. SOPS_AGE_KEY_FILE
      # rides on sops-nix's keyFile option while sops-nix is still installed
      # (Phase 5 replaces that bootstrap). Root-run service → the age key
      # (root-readable) adds no privilege delta (§4.3 boundary 4).
      wrappedNotifyScript = topLevel.config.constants.secretspec.mkWrapper pkgs {
        name = "failure-notifs-pushover-wrapped";
        profile = config.networking.hostName;
        scope = "failure-notifs-${config.networking.hostName}";
        ageKeyFile = config.sops.age.keyFile;
        secretspec = pkgs-unstable.secretspec;
        glueEnv = {
          PUSHOVER_USER_KEY_FILE = "$pushover_user_key";
          PUSHOVER_TOKEN_FILE = "$pushover_token";
        };
        target = notifyScript;
      };
    in
    {
      options.services.failure-notifs = {
        enable = lib.mkEnableOption "systemd failure notifications sent directly to Pushover";

        priority = lib.mkOption {
          type = lib.types.ints.between (-2) 2;
          default = 1;
          description = ''
            Pushover message priority (-2..2). Default 1 (high priority: bypasses
            quiet hours). Use 2 for emergency (requires acknowledgement).
          '';
        };

        titlePrefix = lib.mkOption {
          type = lib.types.str;
          default = "systemd failure";
          description = "Prefix for the Pushover notification title.";
        };

        emoji = lib.mkOption {
          type = lib.types.str;
          description = "Emoji prepended to the notification title.";
          default = "🚨";
        };

        attachServices = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          description = "systemd units to attach OnFailure=failure-notifs.service to.";
          default = [ ];
        };

        _lintScript = lib.mkOption {
          type = lib.types.package;
          internal = true;
          description = "Internal: the Pushover notifier script, for the ShellCheck gate.";
        };

        _lintWrapper = lib.mkOption {
          type = lib.types.package;
          internal = true;
          description = "Internal: the SecretSpec exec wrapper (its glue script rides along in the build closure), for the ShellCheck gate.";
        };
      };

      config = lib.mkIf cfg.enable {
        # Register the notifier script + wrapper with the ShellCheck gate
        # (building the wrapper also lints its glue — a build-closure
        # dependency via getExe).
        services.failure-notifs._lintScript = notifyScript;
        services.failure-notifs._lintWrapper = wrappedNotifyScript;

        systemd.services = {
          failure-notifs = {
            description = "Send a Pushover notification on unit failure";
            after = [ "network-online.target" ];
            wants = [ "network-online.target" ];

            unitConfig = {
              StartLimitIntervalSec = 60;
              StartLimitBurst = 10;
            };

            serviceConfig = {
              Type = "oneshot";
              User = "root";
              # ExecStart is the SecretSpec wrapper: it resolves the Pushover
              # credentials (scope failure-notifs-<host>, as_path → 0400
              # child-lifetime temp files) and its glue exports
              # PUSHOVER_USER_KEY_FILE / PUSHOVER_TOKEN_FILE before exec'ing
              # the notifier script. systemd's MONITOR_* metadata still
              # reaches the script through env inheritance (`secretspec run`
              # passes the parent environment through).
              ExecStart = lib.getExe wrappedNotifyScript;
            };
          };
        }
        // builtins.listToAttrs (
          builtins.map (name: {
            inherit name;
            value = {
              unitConfig.OnFailure = [ "failure-notifs.service" ];
            };
          }) cfg.attachServices
        );
      };
    };

  # Register the notifier script into the ShellCheck gate by harvesting the
  # package built inside the augustus NixOS evaluation (same pattern as
  # kanidm-posix / technitium-provisioning).
  flake.lintedShellScripts =
    let
      augustus = topLevel.config.flake.nixosConfigurations.augustus or null;
      script =
        if augustus == null then null else augustus.config.services.failure-notifs._lintScript or null;
      wrapper =
        if augustus == null then null else augustus.config.services.failure-notifs._lintWrapper or null;
    in
    lib.optionals (script != null) [ (_pkgs: script) ]
    ++ lib.optionals (wrapper != null) [
      (_pkgs: wrapper)
    ];
}
