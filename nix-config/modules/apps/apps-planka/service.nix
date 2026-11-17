{ inputs, config, ... }:
let
  c = config.constants;
  svc = c.services.planka;

  plankaDir = svc.stateDir;
  userAvatars = "${plankaDir}/user-avatars";
  projectBackgroundImages = "${plankaDir}/background-images";
  attachments = "${plankaDir}/attachments";
  favicons = "${plankaDir}/favicons";

  plankaUserName = svc.clientId;
  plankaDbName = plankaUserName;

  plankaAdminRole = "admin";
  plankaPORole = "project_owner";
  plankaUserRole = "board_user";

  containerPlankaSecretKeyFile = "/run/secrets/planka-secret-key";
  containerPlankaOIDCClientSecretFile = "/run/secrets/oidc-client-secret";
  containerPlankaDefaultAdminFile = "/run/secrets/planka-default-admin-password";
  containerPlankaDbPasswordFile = "/run/secrets/planka-db-password";

  containerRootCert = "/data/ca.pem";

  plankaStartScript = inputs.self + "/nix-config/system-configs/augustus/planka-start.sh";
in
{
  flake.modules.nixos.planka-service =
    {
      config,
      lib,
      pkgs,
      inputs,
      ...
    }:
    let
      caCert = config.environment.etc."ssl/certs/ca-certificates.crt".source;
      sopsFile = inputs.self + "/nix-config/secrets/${config.networking.hostName}/planka.yaml";
    in
    {
      imports = [ inputs.self.modules.nixos.users-planka ];

      # Per-service sops file (secrets/<host>/planka.yaml). The OIDC
      # planka_client_secret (kanidm-owned) is declared in catalog.nix from the
      # same file and rendered into the planka-client-secret template consumed
      # by the start script below.
      sops.secrets = {
        planka_secret_key = {
          inherit sopsFile;
          owner = "planka";
        };
        planka_db_pass = {
          inherit sopsFile;
          owner = "planka";
          group = "planka-db-pass";
          mode = "0440";
        };
        planka_default_admin_pass = {
          inherit sopsFile;
          owner = "planka";
        };
        planka_restic_backup_passphrase = {
          inherit sopsFile;
          owner = "restic";
        };
      };
      sops.templates."planka-client-secret" = {
        content = config.sops.placeholder.planka_client_secret;
        owner = "planka";
      };

      services.postgresql.ensureDatabases = [
        plankaDbName
      ];

      services.postgresql.ensureUsers = [
        {
          name = plankaUserName;
          ensureDBOwnership = true;
        }
      ];

      users.groups.planka-db-pass.members = [
        "planka"
        "postgres"
      ];

      services.peesequel.provisionPasswords = {
        planka = config.sops.secrets.planka_db_pass.path;
      };

      virtualisation.oci-containers.containers.planka = {
        image = "ghcr.io/plankanban/planka:2.0.0-rc.4";

        user = "${toString config.users.users.planka.uid}:${toString config.users.groups.planka.gid}";

        entrypoint = "./patched-start.sh";

        networks = [ "host" ];

        extraOptions = [
          "--mount=type=tmpfs,dst=/app,U=true"
        ];

        volumes = [
          "${plankaStartScript}:/app/patched-start.sh"
          "${favicons}:/app/public/favicons"
          "${userAvatars}:/app/public/user-avatars"
          "${projectBackgroundImages}:/app/public/background-images"
          "${attachments}:/app/private/attachments"
          "${caCert}:${containerRootCert}"
          "${config.sops.secrets.planka_secret_key.path}:${containerPlankaSecretKeyFile}:ro"
          "${config.sops.templates."planka-client-secret".path}:${containerPlankaOIDCClientSecretFile}:ro"
          "${config.sops.secrets.planka_default_admin_pass.path}:${containerPlankaDefaultAdminFile}:ro"
          "${config.sops.secrets.planka_db_pass.path}:${containerPlankaDbPasswordFile}:ro"
        ];

        environment = {
          SHOW_DETAILED_AUTH_ERRORS = "true";

          DEFAULT_LANGUAGE = "en-US";
          DEFAULT_ADMIN_EMAIL = "planka-admin@a.${c.baseDomain}";
          DEFAULT_ADMIN_PASSWORD__FILE = containerPlankaDefaultAdminFile;
          DEFAULT_ADMIN_NAME = "Plato Splunk Admin";
          DEFAULT_ADMIN_USERNAME = "admin";

          REQUESTS_CA_BUNDLE = containerRootCert;
          NODE_EXTRA_CA_CERTS = containerRootCert;

          BASE_URL = svc.url;
          TRUST_PROXY = "true";
          DATABASE_URL = "postgresql://planka:\${DATABASE_PASSWORD}@${c.postgres.domain}/planka?ssl=true&sslmode=verify-full";
          DATABASE_PASSWORD__FILE = containerPlankaDbPasswordFile;
          PGHOST = c.postgres.domain;
          PGUSER = "planka";
          PGDATABASE = "planka";
          PGPORT = builtins.toString c.postgres.port;
          PGSSLMODE = "verify-full";
          PGSSLROOTCERT = containerRootCert;
          SECRET_KEY__FILE = containerPlankaSecretKeyFile;

          OIDC_ISSUER = "https://${c.idm.domain}/oauth2/openid/${svc.clientId}";
          OIDC_CLIENT_ID = svc.clientId;
          OIDC_CLIENT_SECRET__FILE = containerPlankaOIDCClientSecretFile;
          OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG = "ES256";

          OIDC_ADMIN_ROLES = plankaAdminRole;
          OIDC_PROJECT_OWNER_ROLES = plankaPORole;
          OIDC_BOARD_USER_ROLES = plankaUserRole;
          OIDC_CLAIMS_SOURCE = "id_token";
          OIDC_IGNORE_USERNAME = "true";
          OIDC_ENFORCED = "true";
          OIDC_ROLES_ATTRIBUTE = "roles";
        };
      };

      # Caddy reverse proxy now generated from the catalog (modules/apps/apps-planka/catalog.nix).

      services.restic.backups.planka = {
        user = "restic";
        repository = "/mnt/backups/planka";
        initialize = true;
        passwordFile = config.sops.secrets.planka_restic_backup_passphrase.path;
        paths = [ plankaDir ];
        timerConfig = {
          OnCalendar = "Mon..Sun *-*-* 23:30:00";
          Persistent = true;
        };
        package = pkgs.writeShellScriptBin "restic" ''
          exec /run/wrappers/bin/restic "$@"
        '';
      };

      services.failure-notifs.attachServices = [
        "podman-planka"
        "restic-backups-planka"
      ];
    };
}
