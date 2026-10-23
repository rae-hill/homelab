{ config, ... }:
let
  c = config.constants;
  svc = c.services.openwebui;
in
{
  flake.modules.nixos.openwebui-service =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      sops.templates."openwebui-env" = {
        owner = "openwebui";
        group = "openwebui";
        content = ''
          WEBUI_URL=${svc.url}
          WEBUI_SECRET_KEY=${config.sops.placeholder."openwebui_app_secret_key"}

          ENABLE_SIGNUP=False
          ENABLE_LOGIN_FORM=False
          ENABLE_PASSWORD_AUTH=False
          ENABLE_VERSION_UPDATE_CHECK=False

          ENABLE_OAUTH_ROLE_MANAGEMENT=True
          ENABLE_OAUTH_SIGNUP=True
          OAUTH_ALLOWED_ROLES=user
          OAUTH_ADMIN_ROLES=admin

          OAUTH_CLIENT_ID=${svc.clientId}
          OAUTH_CLIENT_SECRET=${config.sops.placeholder."openwebui_client_secret"}
          OPENID_PROVIDER_URL=${c.idm.mkOidcEndpoint svc.clientId}
          OAUTH_PROVIDER_NAME=Kanidm
          OAUTH_CODE_CHALLENGE_METHOD=S256
          OPENID_REDIRECT_URI=${svc.url}/oauth/oidc/callback

          SSL_CERT_FILE=${config.environment.etc."ssl/certs/ca-certificates.crt".source}

          SCARF_NO_ANALYTICS=True
          DO_NOT_TRACK=True
          ANONYMIZED_TELEMETRY=False
        '';
      };

      services.open-webui = {
        port = svc.port;
        stateDir = svc.stateDir;
        host = "127.0.0.1";
        enable = true;
        environmentFile = config.sops.templates."openwebui-env".path;
      };

      # Caddy reverse proxy now generated from the catalog (features/openwebui/catalog.nix).

      systemd.services.open-webui.serviceConfig = {
        User = "openwebui";
        Group = "openwebui";
      };

      services.restic.backups.openwebui = {
        user = "restic";
        repository = "/mnt/backups/openwebui";
        initialize = true;
        passwordFile = config.sops.secrets.openwebui_restic_backup_passphrase.path;
        paths = [ "${svc.stateDir}/data" ];
        timerConfig = {
          OnCalendar = "Mon..Sun *-*-* 23:30:00";
          Persistent = true;
        };
        package = pkgs.writeShellScriptBin "restic" ''
          exec /run/wrappers/bin/restic "$@"
        '';
      };

      services.failure-notifs.attachServices = [
        "open-webui"
        "restic-backups-openwebui"
      ];
    };
}
