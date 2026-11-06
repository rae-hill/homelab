{
  lib,
  config,
  pkgs,
  ...
}:
let
  stepCaClientId = "step-ca";
in
{
  programs.git.enable = true;

  programs.zsh.enable = true;

  environment.systemPackages = with pkgs; [
    vim
    step-cli
  ];

  networking.hosts = {
    "127.0.0.1" = [ "postgres-augustus.plato-splunk.media" ];
  };

  services.iperf3 = {
    openFirewall = true;
    enable = true;
  };

  services.peesequel = {
    enable = true;
    package = pkgs.postgresql_17_jit;
    enableBackup = true;
    tlsDomain = "postgres-augustus.plato-splunk.media";

    ensureDatabases = [
      "jacob"
      "ca"
    ];

    ensureUsers = [
      {
        name = "jacob";
        ensureDBOwnership = true;
      }
      {
        name = "ca";
        ensureDBOwnership = true;
      }
    ];
  };

  services.kanidm.provision.systems.oauth2."${stepCaClientId}" = {
    originUrl = "http://127.0.0.1:10000";
    originLanding = "http://127.0.0.1:10000";
    displayName = "Step CA";
    allowInsecureClientDisablePkce = false;
    basicSecretFile = config.sops.secrets.step_ca_oidc_client_secret.path;
    scopeMaps."step-ca.access" = [
      "openid"
      "email"
    ];
  };

  services.homelab-api = {
    enable = true;
    originUrl = "https://homelab-api.plato-splunk.media";
    privateKeySecretPath = config.sops.secrets.homelab_api_jwk_password.path;
    serialNumbersFile = config.sops.templates."serial-numbers-file".path;
    # Headless chrome for POST /resume/print (remote-printing feature). Chrome makes the
    # best PDFs; the wrapper resolves its own runtime deps via absolute store paths.
    # resumeSiteUrl is set by services.resume-site.enable (features/resume-site).
    chromeExecutable = "${pkgs.google-chrome}/bin/google-chrome-stable";
    apiKeys = {
      jacob = {
        apiKeyFile = config.sops.secrets.homelab_api_key_jacob.path;
        email = "jacob@plato-splunk.media";
        permissions = [
          "Status_Health"
          "Status_Self"
          "OAuth_Token"
          "Config_Certs"
          "Config_Wifi"
        ];
      };
    };
  };

  services.homelab-secret-provisioner = {
    enable = true;
    privateKeyPasswordFile = config.sops.secrets.homelab_api_jwk_password.path;
    apiKeys = config.services.homelab-api.apiKeys;
  };

  # Loopback static resume SPA served by Caddy for homelab-api's PDF printing;
  # enabling it also points services.homelab-api.resumeSiteUrl at the vhost
  # (see features/resume-site/caddy.nix).
  services.resume-site.enable = true;

  services.restic.backups.postgres = {
    user = "restic";
    repository = "/mnt/backups/postgres";
    initialize = true;
    passwordFile = config.sops.templates."postgres-backup-passphrase".path;
    paths = [
      "${config.services.postgresqlBackup.location}/all.sql.gz"
    ];
    timerConfig = {
      OnCalendar = "Mon..Sun *-*-* 01:30:00";
      Persistent = true;
    };
    package = pkgs.writeShellScriptBin "restic" ''
      exec /run/wrappers/bin/restic "$@"
    '';
  };
}
