{ config, ... }:
let
  c = config.constants;
  svc = c.services.habitsync;

  habitsyncDir = svc.stateDir;
  dataDir = "${habitsyncDir}/data";

  habitsyncUserName = svc.clientId;
  habitsyncDbName = habitsyncUserName;

  containerDbPasswordFile = "/run/secrets/habitsync-db-password";
  containerJwtSecretFile = "/run/secrets/habitsync-jwt-secret";
  containerEnvFile = "/run/secrets/habitsync-env";
  containerRootCert = "/etc/ssl/certs/ca.pem";
  containerTrustStore = "/etc/ssl/certs/truststore.p12";
in
{
  flake.modules.nixos.habitsync-service =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      # PostgreSQL database and user
      services.postgresql.ensureDatabases = [
        habitsyncDbName
      ];

      services.postgresql.ensureUsers = [
        {
          name = habitsyncUserName;
          ensureDBOwnership = true;
        }
      ];

      users.groups.habitsync-db-pass.members = [
        "habitsync"
        "postgres"
      ];

      services.peesequel.provisionPasswords = {
        habitsync = config.sops.secrets.habitsync_db_pass.path;
      };

      # User and group provisioning
      users.groups.habitsync = {
        gid = 6842;
      };

      users.users.habitsync = {
        uid = 6842;
        isSystemUser = true;
        group = "habitsync";
        home = habitsyncDir;
        createHome = true;
      };

      # Ensure state directories exist
      systemd.tmpfiles.rules = [
        "d ${dataDir} 0750 habitsync habitsync -"
      ];

      # SOPS template for container secrets
      sops.templates."habitsync-env" = {
        owner = "habitsync";
        group = "habitsync";
        content = ''
          SPRING_DATASOURCE_PASSWORD=${config.sops.placeholder.habitsync_db_pass}
          JWT_SECRET=${config.sops.placeholder.habitsync_jwt_secret}
        '';
      };

      # Container definition
      virtualisation.oci-containers.containers.habitsync = {
        image = "ghcr.io/jofoerster/habitsync:latest";

        networks = [ "host" ];

        volumes = [
          "${dataDir}:/data"
          "${c.ca.rootCert}:${containerRootCert}:ro"
          "${c.ca.rootTrustStore}:${containerTrustStore}:ro"
        ];

        environmentFiles = [ config.sops.templates."habitsync-env".path ];

        environment = {
          BASE_URL = svc.url;
          SPRING_DATASOURCE_URL = "jdbc:postgresql://${c.postgres.domain}:${builtins.toString c.postgres.port}/${habitsyncDbName}?ssl=true&sslmode=verify-full&sslrootcert=${containerRootCert}";
          SPRING_DATASOURCE_USERNAME = habitsyncUserName;
          SPRING_DATASOURCE_DRIVER_CLASS_NAME = "org.postgresql.Driver";
          APP_SECURITY_ISSUERS_KANIDM_URL = "https://${c.idm.domain}/oauth2/openid/${svc.clientId}";
          APP_SECURITY_ISSUERS_KANIDM_CLIENT-ID = svc.clientId;
          APP_SECURITY_ISSUERS_KANIDM_NEEDS-CONFIRMATION = "false";
          PUID = toString config.users.users.habitsync.uid;
          PGID = toString config.users.groups.habitsync.gid;
          PAGE_CHALLENGES_VISIBLE = "true";
          TRACKER_FIRSTDAYOFWEEK = "MONDAY";
          JAVA_TOOL_OPTIONS = "-Djavax.net.ssl.trustStore=${containerTrustStore} -Djavax.net.ssl.trustStorePassword=changeit -Djavax.net.ssl.trustStoreType=PKCS12";
        };
      };

      # Caddy reverse proxy now generated from the catalog (features/habitsync/catalog.nix).

      # Restic backup
      services.restic.backups.habitsync = {
        user = "restic";
        repository = "/mnt/backups/habitsync";
        initialize = true;
        passwordFile = config.sops.secrets.habitsync_restic_backup_passphrase.path;
        paths = [ dataDir ];
        timerConfig = {
          OnCalendar = "Mon..Sun *-*-* 23:30:00";
          Persistent = true;
        };
        package = pkgs.writeShellScriptBin "restic" ''
          exec /run/wrappers/bin/restic "$@"
        '';
      };

      services.failure-notifs.attachServices = [
        "podman-habitsync"
        "restic-backups-habitsync"
      ];
    };
}
