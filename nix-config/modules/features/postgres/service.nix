{ inputs, config, ... }:
let
  c = config.constants;
  svc = c.services.postgres;
in
{
  flake.modules.nixos.postgres-service =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.peesequel;
      inherit (cfg) package dataDir;
      acmePort = svc.acmePort;
      domain = cfg.tlsDomain;
      inherit (config.security.acme.certs."${domain}") directory;

      postgresCredsDir = "/var/lib/postgresql/certs";
      certFiles = {
        fullchain = "fullchain.pem";
        key = "key.pem";
        chain = "chain.pem";
        rootCA = "root-ca.pem";
      };

      updateCertsScript = pkgs.writeShellScript "update-postgres-certs" ''
        set -euo pipefail

        mkdir -p ${postgresCredsDir}

        cp ${directory}/${certFiles.fullchain} ${postgresCredsDir}/${certFiles.fullchain}
        cp ${directory}/${certFiles.key} ${postgresCredsDir}/${certFiles.key}
        cp ${directory}/${certFiles.chain} ${postgresCredsDir}/${certFiles.chain}
        cp /etc/ssl/certs/ca-certificates.crt ${postgresCredsDir}/${certFiles.rootCA}

        chown postgres:postgres ${postgresCredsDir}/${certFiles.fullchain}
        chown postgres:postgres ${postgresCredsDir}/${certFiles.key}
        chown postgres:postgres ${postgresCredsDir}/${certFiles.chain}
        chown postgres:postgres ${postgresCredsDir}/${certFiles.rootCA}

        chmod 644 ${postgresCredsDir}/${certFiles.fullchain}
        chmod 600 ${postgresCredsDir}/${certFiles.key}
        chmod 644 ${postgresCredsDir}/${certFiles.chain}
        chmod 644 ${postgresCredsDir}/${certFiles.rootCA}

        echo "Successfully updated PostgreSQL certificates"
      '';
    in
    {
      options.services.peesequel = {
        enable = lib.mkEnableOption "PostgreSQL server with custom configuration";

        package = lib.mkOption {
          type = lib.types.package;
          default = pkgs.postgresql_17_jit;
          description = "PostgreSQL package to use";
        };

        dataDir = lib.mkOption {
          type = lib.types.str;
          default = "/var/lib/postgresql/${config.services.postgresql.package.psqlSchema}";
          description = "Data directory for PostgreSQL";
        };

        port = lib.mkOption {
          type = lib.types.port;
          default = 5432;
          description = "Port for PostgreSQL to listen on";
        };

        maxConnections = lib.mkOption {
          type = lib.types.int;
          default = 100;
          description = "Maximum number of concurrent connections";
        };

        ensureDatabases = lib.mkOption {
          type = lib.types.listOf lib.types.str;
          default = [ ];
          description = "List of databases to ensure exist";
        };

        ensureUsers = lib.mkOption {
          type = lib.types.listOf lib.types.attrs;
          default = [ ];
          description = "List of users to ensure exist";
        };

        enableBackup = lib.mkOption {
          type = lib.types.bool;
          default = false;
          description = "Enable PostgreSQL backups";
        };

        backupLocation = lib.mkOption {
          type = lib.types.str;
          default = "/var/backup/postgresql";
          description = "Location for PostgreSQL backups";
        };

        additionalSettings = lib.mkOption {
          type = lib.types.attrs;
          default = { };
          description = "Additional PostgreSQL settings";
        };

        tlsDomain = lib.mkOption {
          type = lib.types.str;
          description = "The domain for the Postgres server's TLS cert";
        };

        provisionPasswords = lib.mkOption {
          type = lib.types.attrsOf lib.types.str;
          default = { };
          description = "Attribute set of username to password file path for provisioning user passwords";
        };

        grantRoles = lib.mkOption {
          type = lib.types.attrsOf (lib.types.listOf lib.types.str);
          default = { };
          description = "Attribute set of username to list of PostgreSQL roles to grant (e.g. { prometheus_exporter = [ \"pg_monitor\" ]; })";
        };
      };

      config = lib.mkIf cfg.enable {
        services.postgresql = {
          inherit package dataDir;
          enable = true;

          inherit (cfg) ensureDatabases ensureUsers;

          settings = lib.mkMerge [
            {
              port = cfg.port;
              max_connections = cfg.maxConnections;

              listen_addresses = lib.mkForce "0.0.0.0,::";

              log_connections = true;
              log_statement = "all";
              logging_collector = true;
              log_disconnections = true;
              log_destination = lib.mkForce "syslog";

              ssl = true;
              ssl_cert_file = "${postgresCredsDir}/${certFiles.fullchain}";
              ssl_key_file = "${postgresCredsDir}/${certFiles.key}";
              ssl_ca_file = "${postgresCredsDir}/${certFiles.rootCA}";
            }
            cfg.additionalSettings
          ];

          identMap = ''
            # ArbitraryMapName systemUser          DBUser
              superuser_map      root                postgres
              superuser_map      postgres            postgres
            # Let other names login as themselves
              superuser_map      /^(.*)$             \1
            # Map certificate CN (subdomain.domain.tld) to subdomain username
              cert_map           /^([^.]+)\.${lib.escapeRegex c.baseDomain}$  \1
          '';

          authentication = lib.mkForce ''
            # TYPE  DATABASE        USER            ADDRESS                 METHOD   OPTIONS

            # "local" is for Unix domain socket connections only
            # Superuser access for trusted users
              local   all             postgres                                peer     map=superuser_map
            # Other users restricted to their own database via peer authentication
              local   sameuser        all                                     peer     map=superuser_map

            # Network connections with SSL required
            # Password authentication over SSL for localhost:
              hostssl sameuser        all             127.0.0.1/32            scram-sha-256
              hostssl sameuser        all             ::1/128                 scram-sha-256
            # Client certificate authentication over SSL for remote:
              hostssl sameuser        all             0.0.0.0/0               cert     map=cert_map
              hostssl sameuser        all             ::/0                    cert     map=cert_map
          '';
        };

        systemd.services.postgresql-provision-passwords =
          lib.mkIf (cfg.enable && cfg.provisionPasswords != { })
            {
              description = "Provision PostgreSQL user passwords";
              after = [ "postgresql.service" ];
              wantedBy = [ "multi-user.target" ];
              requires = [ "postgresql.service" ];
              partOf = [ "postgresql.service" ];

              serviceConfig = {
                Type = "oneshot";
                RemainAfterExit = true;
                User = "postgres";
              };

              script = lib.concatStringsSep "\n" (
                lib.mapAttrsToList (user: passwordFile: ''
                  ${config.services.postgresql.package}/bin/psql -v "ON_ERROR_STOP=1" -c "ALTER USER $(${pkgs.coreutils}/bin/printf '%s' ${lib.escapeShellArg user} | ${pkgs.gnused}/bin/sed 's/[^a-zA-Z0-9_-]//g') WITH PASSWORD \$\$$(${pkgs.coreutils}/bin/cat ${lib.escapeShellArg passwordFile})\$\$;"
                '') cfg.provisionPasswords
              );
            };

        systemd.services.postgresql-grant-roles = lib.mkIf (cfg.enable && cfg.grantRoles != { }) {
          description = "Grant PostgreSQL roles to users";
          after = [ "postgresql.service" ];
          wantedBy = [ "multi-user.target" ];
          requires = [ "postgresql.service" ];
          partOf = [ "postgresql.service" ];

          serviceConfig = {
            Type = "oneshot";
            RemainAfterExit = true;
            User = "postgres";
          };

          script = lib.concatStringsSep "\n" (
            lib.mapAttrsToList (
              user: roles:
              lib.concatStringsSep "\n" (
                map (role: ''
                  ${config.services.postgresql.package}/bin/psql -v "ON_ERROR_STOP=1" -c "GRANT ${role} TO ${user};"
                '') roles
              )
            ) cfg.grantRoles
          );
        };

        systemd.services.postgresql-update-certs = lib.mkIf cfg.enable {
          description = "Update PostgreSQL TLS certificates from ACME";
          after = [ "acme-${domain}.service" ];
          wantedBy = [ "multi-user.target" ];

          serviceConfig = {
            Type = "oneshot";
            RemainAfterExit = false;
            User = "root";
            ExecStart = updateCertsScript;
            ExecStartPost = "${pkgs.systemd}/bin/systemctl restart postgresql.service";
          };
        };

        services.postgresqlBackup = lib.mkIf cfg.enableBackup {
          enable = true;
          backupAll = true;
          location = cfg.backupLocation;
        };

        # Caddy http://postgres-augustus challenge vhost + the ACME cert are now generated from
        # the catalog (features/postgres/catalog.nix). The server still reads the cert dir via the
        # `inherit (config.security.acme.certs."${domain}") directory;` binding — the generator
        # creates the same cert name, so the directory path is unchanged.

        users.groups.postgres-certs = lib.mkIf cfg.enable {
          members = [ "postgres" ];
        };

        services.failure-notifs.attachServices = [
          "postgresql"
          "postgresql-provision-passwords"
          "postgresql-update-certs"
          "restic-backups-postgres"
        ];
      };
    };
}
