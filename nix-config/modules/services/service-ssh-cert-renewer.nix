{ config, ... }:
let
  c = config.constants;
in
{
  flake.modules.nixos.ssh-cert-renewer =
    { inputs, config, lib, pkgs, ... }:
    let
      cfg = config.services.ssh-cert-renewer;
    in
    {
      options.services.ssh-cert-renewer = {
        enable = lib.mkEnableOption "SSH certificate renewal service";

        serviceName = lib.mkOption {
          type = lib.types.str;
          description = "The domain of the ssh host";
        };

        jwkPrivName = lib.mkOption {
          type = lib.types.str;
          description = "The JSON private key for requesting tokens";
          default = "step-jwk-priv.json";
        };

        sshKeyName = lib.mkOption {
          type = lib.types.str;
          description = "Name of the SSH key (without extension)";
        };

        passwordFile = lib.mkOption {
          type = lib.types.str;
          description = "Path to file containing the service account password";
        };

        keyDirectory = lib.mkOption {
          type = lib.types.str;
          default = "/etc/ssh";
          description = "Directory where SSH keys are stored";
        };
      };

      config = lib.mkIf cfg.enable {
        systemd.services.ssh-cert-renewer = {
          description = "SSH Certificate Renewal Service";
          after = [ "network-online.target" ];
          wants = [ "network-online.target" ];

          serviceConfig = {
            Type = "oneshot";
            User = "root";
            ExecStopPost = "${pkgs.systemd}/bin/systemctl try-restart sshd.service";
          };

          script = ''
            set -euo pipefail

            KEY_DIR="${cfg.keyDirectory}"
            KEY_NAME="${cfg.sshKeyName}"
            CERT_PUB="$KEY_DIR/$KEY_NAME-cert.pub"
            KEY_PUB="$KEY_DIR/$KEY_NAME.pub"
            KEY_PRIV="$KEY_DIR/$KEY_NAME"
            JWK_PRIV="$(${pkgs.step-cli}/bin/step path)/${cfg.jwkPrivName}"

            echo "Checking SSH certificate expiration for $CERT_PUB"

            if [ ! -f "$CERT_PUB" ] || ${pkgs.step-cli}/bin/step ssh needs-renewal "$CERT_PUB"; then
              if [ ! -f "$CERT_PUB" ]; then
                echo "Certificate does not exist - requesting new token"
              else
                echo "Certificate needs renewal - requesting new token"
              fi

              TOKEN=$(${pkgs.step-cli}/bin/step ca token ${cfg.serviceName} \
                --root ${c.ca.rootCert} \
                --ca-url ${c.ca.url} \
                --ssh \
                --host \
                --key "$JWK_PRIV" \
                --provisioner ${cfg.serviceName} \
                --password-file=${cfg.passwordFile} \
                --not-after "30m")

              if [ -n "$TOKEN" ]; then
                echo "Token acquired, requesting certificate renewal"

                ${pkgs.step-cli}/bin/step ssh certificate ${cfg.serviceName} "$KEY_PUB" \
                  --host \
                  --sign \
                  --provisioner ${cfg.serviceName} \
                  --token "$TOKEN"

                echo "Certificate renewed successfully via token"
              else
                echo "Failed to acquire token" >&2
                exit 1
              fi
            else
              echo "Certificate still valid - performing standard renewal"

              ${pkgs.step-cli}/bin/step ssh renew --ca-url ${c.ca.url} --root ${c.ca.rootCert} "$CERT_PUB" "$KEY_PRIV" --force

              echo "Certificate renewed successfully via standard renewal"
            fi
          '';
        };

        systemd.timers.ssh-cert-renewer = {
          description = "Timer for SSH Certificate Renewal";
          wantedBy = [ "timers.target" ];

          timerConfig = {
            OnCalendar = "daily";
            Persistent = true;
            Unit = "ssh-cert-renewer.service";
          };
        };
      };
    };
}
