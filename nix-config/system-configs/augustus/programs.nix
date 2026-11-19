{ inputs, ... }:
{
  flake.modules.nixos.host-augustus-programs =
    {
      inputs,
      lib,
      config,
      pkgs,
      ...
    }:
    let
      stepCaClientId = "step-ca";
      homelabApiSecrets = ./secrets/homelab-api.yaml;
    in
    {
      # Host-specific sops declarations, each pointing at its per-service file
      # Host-specific sops declarations from ./secrets/ (moved out of the
      # former augustus/sops.nix and secrets/augustus/):
      #   step-ca.yaml      — the kanidm-issued OIDC client secret for step-ca
      #   homelab-api.yaml  — augustus-only API extras (jacob's API key, the
      #                       resume-tailor OpenRouter key, device serials)
      #   postgres.yaml     — the restic passphrase for the postgres backup job
      sops.secrets = {
        step_ca_oidc_client_secret = {
          sopsFile = ./secrets/step-ca.yaml;
          owner = "kanidm";
        };
        homelab_api_key_jacob = {
          sopsFile = homelabApiSecrets;
          owner = "homelab-api";
          group = "homelab-api";
        };
        homelab_api_openrouter_key = {
          sopsFile = homelabApiSecrets;
          owner = "homelab-api";
          group = "homelab-api";
        };
        ipad_serial_number = {
          sopsFile = homelabApiSecrets;
          owner = "homelab-api";
          group = "homelab-api";
        };
        iphone_serial_number = {
          sopsFile = homelabApiSecrets;
          owner = "homelab-api";
          group = "homelab-api";
        };
        postgres_restic_backup_passphrase = {
          sopsFile = ./secrets/postgres.yaml;
          owner = "restic";
        };
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

      sops.templates."postgres-backup-passphrase" = {
        content = config.sops.placeholder.postgres_restic_backup_passphrase;
        owner = "restic";
      };

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
        # OpenRouter API key for POST /resume/tailor (resume-tailor feature). Exported as
        # OPENROUTER_API_KEY_FILE via the homelab-api-env template; null on praeconinus
        # keeps the tailor dark there by design.
        openRouterApiKeyFile = config.sops.secrets.homelab_api_openrouter_key.path;
        # Headless chrome for POST /resume/print (remote-printing feature). Chrome makes the
        # best PDFs; the wrapper resolves its own runtime deps via absolute store paths.
        # resumeSiteUrl defaults to the tailnet resume-site vhost via modules/homelab/homelab-resume-site.
        chromeExecutable = "${pkgs.google-chrome}/bin/google-chrome-stable";
        # Typst assets for POST /resume/cover-letter (cover-letter generator): the template,
        # signature image, and vendored letterloom (imported BY PATH — no universe-package
        # resolution, no XDG env), installed by the homelab-api package. Null on
        # praeconinus keeps cover-letter rendering dark there by design.
        # NOTE: references the flake package directly (same source as the module's `pkg`
        # let-binding) — the services.homelab-api.pkg OPTION declaration is a latent
        # mkPackageOption misuse that throws when forced; don't read it until it's fixed.
        typstAssetsDir = "${
          inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.homelab-api
        }/lib/typst-assets";
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

      # The loopback resume-site vhost was replaced by the tailnet catalog entry
      # https://resume.plato-splunk.media (modules/homelab/homelab-resume-site, imported in
      # system-configs/augustus/default.nix) — it also points services.homelab-api.resumeSiteUrl at
      # itself, so nothing to configure here.

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
    };
}
