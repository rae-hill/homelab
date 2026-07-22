{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  sops.defaultSopsFile = inputs.self + "/nix-config/secrets/augustus.yaml";
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";

  sops.secrets.kanidm_admin_passphrase = {
    owner = "kanidm";
    group = "kanidm";
  };

  sops.secrets.kanidm_idm_admin_passphrase = {
    owner = "kanidm";
    group = "kanidm";
  };

  sops.secrets.kanidm_restic_backup_passphrase = {
    owner = "restic";
  };

  sops.templates."kanidm-backup-passphrase" = {
    content = config.sops.placeholder.kanidm_restic_backup_passphrase;
    owner = "restic";
  };

  sops.secrets.postgres_restic_backup_passphrase = {
    owner = "restic";
  };

  sops.templates."postgres-backup-passphrase" = {
    content = config.sops.placeholder.postgres_restic_backup_passphrase;
    owner = "restic";
  };

  sops.secrets.openwebui_client_secret = {
    owner = "kanidm";
  };

  sops.secrets.openwebui_app_secret_key = {
    owner = "openwebui";
  };

  sops.secrets.openwebui_restic_backup_passphrase = {
    owner = "openwebui";
  };

  sops.secrets.home_assistant_client_secret = {
    owner = "kanidm";
  };

  sops.secrets.home_assistant_lat = {
    owner = "hass";
  };

  sops.secrets.home_assistant_long = {
    owner = "hass";
  };

  sops.secrets.unifi_radius_secret = {
    owner = "radiusd";
    group = "radiusd";
  };

  sops.secrets.ui_radius_auth_token = {
    owner = "radiusd";
    group = "radiusd";
  };

  sops.secrets.smb_passphrase = {
    owner = "root";
  };

  sops.templates."smb-creds" = {
    content = ''
      username=augustus
      password=${config.sops.placeholder.smb_passphrase}
    '';
    owner = "root";
  };

  sops.secrets.planka_secret_key = {
    owner = "planka";
  };

  sops.secrets.planka_db_pass = {
    owner = "planka";
    group = "planka-db-pass";
    mode = "0440";
  };

  sops.secrets.planka_default_admin_pass = {
    owner = "planka";
  };

  sops.secrets.planka_client_secret = {
    owner = "kanidm";
  };

  sops.templates."planka-client-secret" = {
    content = config.sops.placeholder.planka_client_secret;
    owner = "planka";
  };

  sops.secrets.planka_restic_backup_passphrase = {
    owner = "restic";
  };

  sops.secrets.step_ca_oidc_client_secret = {
    owner = "kanidm";
  };

  sops.secrets.minecraft_backup_passphrase = {
    owner = "restic";
  };

  sops.secrets.homelab_api_jwk_password = {
    owner = "homelab-api";
    group = "homelab-api";
  };

  sops.secrets.homelab_api_key_jacob = {
    owner = "homelab-api";
    group = "homelab-api";
  };

  sops.secrets.step_jwk_provisioner_password = {
    owner = "root";
  };

  sops.secrets.ipad_serial_number = {
    owner = "homelab-api";
    group = "homelab-api";
  };

  sops.secrets.iphone_serial_number = {
    owner = "homelab-api";
    group = "homelab-api";
  };

  sops.templates."serial-numbers-file" = {
    owner = "homelab-api";
    group = "homelab-api";
    content = builtins.toJSON {
      "100.104.220.114" = config.sops.placeholder.ipad_serial_number;
      "fd7a:115c:a1e0::6f01:dc8c" = config.sops.placeholder.ipad_serial_number;
      "100.69.89.38" = config.sops.placeholder.iphone_serial_number;
      "fd7a:115c:a1e0::601:5927" = config.sops.placeholder.iphone_serial_number;
    };
  };

  sops.secrets.apprise_secret_key = {
    owner = "apprise";
    group = "apprise";
  };

  sops.secrets.apprise_restic_backup_passphrase = {
    owner = "restic";
  };

  sops.secrets.pushover_user_key = {
    owner = "apprise";
    group = "apprise";
  };

  sops.secrets.pushover_token = {
    owner = "apprise";
    group = "apprise";
  };

  sops.secrets.habitsync_db_pass = {
    owner = "habitsync";
    group = "habitsync-db-pass";
    mode = "0440";
  };

  sops.secrets.habitsync_jwt_secret = {
    owner = "habitsync";
    group = "habitsync";
  };

  sops.secrets.habitsync_restic_backup_passphrase = {
    owner = "restic";
  };

  sops.secrets.grafana_client_secret = {
    owner = "kanidm";
  };

  sops.templates."grafana-client-secret" = {
    content = config.sops.placeholder.grafana_client_secret;
    owner = "grafana";
  };

  sops.secrets.grafana_secret = {
    owner = "grafana";
  };

  sops.secrets.grafana_pushover_user_key = {
    owner = "grafana";
  };

  sops.secrets.grafana_pushover_token = {
    owner = "grafana";
  };

  sops.secrets.unpoller_password = {
    owner = "unifi-poller";
    group = "unifi-poller";
    mode = "0400";
  };
}
