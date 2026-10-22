{ config, lib, ... }@topLevel:
{
  # Systemd failure notifications, delivered DIRECTLY to Pushover.
  #
  # Previously this posted to a local Apprise container
  # (failure-notifs -> Apprise -> Pushover). That indirection was unreliable, so
  # this now calls the Pushover Messages API directly
  # (https://api.pushover.net/1/messages.json), mirroring how Grafana already
  # talks to Pushover (userKey + apiToken). Apprise is no longer involved.
  flake.modules.nixos.failure-notifs =
    {
      config,
      lib,
      pkgs,
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
    in
    {
      options.services.failure-notifs = {
        enable = lib.mkEnableOption "systemd failure notifications sent directly to Pushover";

        userKeyFile = lib.mkOption {
          type = lib.types.path;
          description = "Path to a file containing the Pushover user/group key.";
        };

        tokenFile = lib.mkOption {
          type = lib.types.path;
          description = "Path to a file containing the Pushover application API token.";
        };

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
      };

      config = lib.mkIf cfg.enable {
        # Register the notifier script with the ShellCheck gate.
        services.failure-notifs._lintScript = notifyScript;

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
              ExecStart = lib.getExe notifyScript;
              Environment = [
                "PUSHOVER_USER_KEY_FILE=${cfg.userKeyFile}"
                "PUSHOVER_TOKEN_FILE=${cfg.tokenFile}"
              ];
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
    in
    lib.optionals (script != null) [ (_pkgs: script) ];
}
