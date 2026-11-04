{ config, ... }:
let
  c = config.constants;
  svc = c.services.homelab;
in
{
  flake.modules.nixos.homelab-api-service =
    {
      inputs,
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.homelab-api;
      homeDir = cfg.userHomeDir;
      pubJwk = "${homeDir}/jwk.pub.json";
      privJwk = "${homeDir}/jwk.priv.json";
      pkg = inputs.self.packages.${pkgs.stdenv.hostPlatform.system}.homelab-api;
      commitHash =
        inputs.self.rev
          or (throw "Cannot deploy homelab-api from a dirty tree: HOMELAB_COMMIT_HASH requires a clean git commit");
    in
    {
      options.services.homelab-api = {
        enable = lib.mkEnableOption "Homelab API Server";

        pkg = lib.mkPackageOption "homelab-api" {
          description = "The homelab-api package to use";
          default = pkg;
        };

        originUrl = lib.mkOption {
          type = lib.types.str;
          description = "The domain of the API server";
        };

        userName = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          description = "The system user for homelab";
          default = "homelab-api";
        };

        userGid = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          description = "The user's GID for the homelab server service";
          default = 26696;
        };

        userUid = lib.mkOption {
          type = lib.types.nullOr lib.types.int;
          description = "The user's UID for the homelab server service";
          default = 26697;
        };

        userHomeDir = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          description = "The absolute path of the homelab server user's home directory";
          default = "/var/lib/${cfg.userName}";
        };

        provisionJwks = lib.mkOption {
          type = lib.types.nullOr lib.types.bool;
          description = "Enables construction of a private and public JWK pair for the token issuer.";
          default = true;
        };

        hmacSecretPath = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          description = "a path to the HMAC secret";
          default = null;
        };

        privateKeySecretPath = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          description = "a path to the private key encryption key";
          default = null;
        };

        featureFlags = lib.mkOption {
          type = lib.types.nonEmptyListOf lib.types.str;
          default = [ "*" ];
          description = "The enabled feature flags for the service";
        };

        requiresKanidm = lib.mkOption {
          type = lib.types.bool;
          default = true;
          description = "Whether the service depends on kanidm.service";
        };

        apiKeys = lib.mkOption {
          type = lib.types.attrsOf (
            lib.types.submodule {
              options = {
                apiKeyFile = lib.mkOption {
                  type = lib.types.str;
                  description = "The path to this API key's file";
                };
                email = lib.mkOption {
                  type = lib.types.str;
                  description = "The email associated with this user's API key";
                };
                permissions = lib.mkOption {
                  type = lib.types.nonEmptyListOf (
                    lib.types.enum [
                      "Config_Wifi"
                      "Config_Certs"
                      "Cert_Root"
                      "Cert_Intermediate"
                      "Cert_Combined"
                      "Status_Health"
                      "Status_Self"
                      "OAuth_Token"
                      "OAuth_ClaimCheck"
                      "Resume_Print"
                    ]
                  );
                };
              };
            }
          );
          default = { };
          description = "The API keys for the local token issuer, keyed by name";
        };

        serialNumbersFile = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          description = "Path to a JSON file mapping IP addresses to device serial numbers";
          default = null;
        };

        chromeExecutable = lib.mkOption {
          type = lib.types.nullOr lib.types.str;
          description = ''
            Absolute path to the chrome/chromium executable used by the resume PDF print
            service (POST /resume/print → puppeteer-core). Exported as CHROME_EXECUTABLE.
            Leave null on deployments where the resume group stays dark (e.g. praeconinus).
          '';
          default = null;
        };
      };

      config = lib.mkIf cfg.enable {
        services.homelab-api.hmacSecretPath = lib.mkDefault "${homeDir}/${svc.hmacFileName}";

        assertions = [
          {
            assertion = cfg.provisionJwks -> cfg.privateKeySecretPath != null && cfg.hmacSecretPath != null;
            message = ''
              <option>services.homelab-api.privateKeySecretPath</option> and
              <option>services.homelab-api.hmacSecretPath</option> must be set when provisioning JWKs
            '';
          }
        ];

        users.groups."${cfg.userName}" = {
          gid = cfg.userGid;
        };

        users.users."${cfg.userName}" = {
          uid = cfg.userUid;
          isSystemUser = true;
          group = cfg.userName;
          home = cfg.userHomeDir;
        };

        sops.templates."homelab-api-env" = {
          owner = cfg.userName;
          group = cfg.userName;
          content = ''
            PORT=${builtins.toString svc.port}
            HOST=127.0.0.1

            ROOT_CERT_DER=${c.ca.rootCertDer}
            INTERMEDIATE_CERT_DER=${c.ca.intermediateCertDer}
            ROOT_CERT_CRT=${c.ca.rootCert}
            INTERMEDIATE_CERT_CRT=${c.ca.intermediateCert}

            HOMELAB_ORIGIN_URL=${cfg.originUrl}

            ${if cfg.provisionJwks then "TOKEN_ISSUER_PRIVATE_KEY_PATH=${privJwk}" else ""}
            ${if cfg.provisionJwks then "TOKEN_ISSUER_PUBLIC_KEY_PATH=${pubJwk}" else ""}
            ${
              if cfg.provisionJwks then "TOKEN_ISSUER_PRIVATE_KEY_SECRET_PATH=${cfg.privateKeySecretPath}" else ""
            }
            ${if cfg.provisionJwks then "HOMELAB_SECRET_FILE=${cfg.hmacSecretPath}" else ""}
            ${if cfg.provisionJwks then "API_KEYS_FILE=${homeDir}/api-keys.json" else ""}

            FEATURE_FLAGS=${
              lib.concatStringsSep "," (map (f: if f == "*" then f else "${f}.enabled") cfg.featureFlags)
            }
            KANIDM_OPENID_PROVIDER_URL=${svc.oidcEndpoint}

            CA_URL=${c.ca.url}
            ACME_DIRECTORY_PATH=/acme/eap/directory
            ACME_HARDWARE_BOUND=true
            ACME_KEY_TYPE=ECSECPrimeRandom
            ACME_KEY_SIZE=256
            ${if cfg.serialNumbersFile != null then "SERIAL_NUMBERS_FILE=${cfg.serialNumbersFile}" else ""}
            ${if cfg.chromeExecutable != null then "CHROME_EXECUTABLE=${cfg.chromeExecutable}" else ""}
            ${
              if config.services.tempo.enable then
                "OTEL_GRPC_ENDPOINT_URL=http://127.0.0.1:${toString c.services.tempo.grpcPort}"
              else
                ""
            }
            HOMELAB_COMMIT_HASH=${commitHash}
          '';
        };

        systemd.services.homelab-api = {
          description = "Homelab API NodeJS Server";

          wantedBy = [ "multi-user.target" ];
          after = [
            "homelab-secret-provisioner.service"
          ]
          ++ lib.optionals cfg.requiresKanidm [
            "kanidm.service"
          ];
          requires = [
            "homelab-secret-provisioner.service"
          ]
          ++ lib.optionals cfg.requiresKanidm [
            "kanidm.service"
          ];

          serviceConfig = {
            Type = "simple";
            User = cfg.userName;
            Group = cfg.userName;
            EnvironmentFile = config.sops.templates."homelab-api-env".path;

            ExecStart = "${pkg}/bin/homelab-api";

            Restart = "on-failure";
            RestartSec = 5;
            CapabilityBoundingSet = [ ];
            DeviceAllow = "";
            LockPersonality = true;
            NoNewPrivileges = true;
            PrivateDevices = true;
            PrivateMounts = true;
            PrivateTmp = true;
            PrivateUsers = true;
            ProcSubset = "pid";
            ProtectClock = true;
            ProtectHome = true;
            ProtectHostname = true;
            ProtectSystem = "strict";
            ProtectControlGroups = true;
            ProtectKernelLogs = true;
            ProtectKernelModules = true;
            ProtectKernelTunables = true;
            ProtectProc = "invisible";
            RestrictAddressFamilies = [ ];
            RestrictNamespaces = true;
            RestrictRealtime = true;
            RestrictSUIDSGID = true;
            SystemCallArchitectures = "native";
          };
        };
      };
    };
}
