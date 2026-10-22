{ config, ... }:
let
  c = config.constants;
  svc = c.services.kanidm;
  unix = c.unix;
in
{
  flake.modules.nixos.kanidm =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      inherit (config.security.acme.certs."${svc.domain}") directory;
    in
    {
      services.kanidm = {
        package = pkgs.kanidmWithSecretProvisioning_1_11;

        client = {
          enable = true;
          settings.uri = config.services.kanidm.server.settings.origin;
        };

        server = {
          enable = true;
          settings = {
            domain = svc.domain;
            origin = "https://${svc.domain}";
            ldapbindaddress = "127.0.0.1:636";
            bindaddress = "127.0.0.1:8443";

            tls_key = "${directory}/key.pem";
            tls_chain = "${directory}/fullchain.pem";

            online_backup = {
              versions = 7;
              path = svc.backupPath;
            };
          };
        };

        provision = {
          adminPasswordFile = config.sops.secrets.kanidm_admin_passphrase.path;
          idmAdminPasswordFile = config.sops.secrets.kanidm_idm_admin_passphrase.path;

          enable = true;
          autoRemove = true;

          groups = {
            "radius.access" = { };
            "radius.access_home" = { };
            "radius.access_guest" = { };
            "radius.access_private" = { };
            "radius.access_admin" = { };
            "radius.access_servers" = { };

            "openwebui.admins" = { };
            "openwebui.access" = { };

            "home-assistant.access" = { };
            "home-assistant.admins" = { };

            "nextcloud.admins" = { };
            "nextcloud.access" = { };

            "jellyfin.admins" = { };
            "jellyfin.access" = { };

            "planka.access" = { };
            "planka.admins" = { };
            "planka.project_owner" = { };

            "step-ca.access" = { };

            "homelab.admins" = { };
            "homelab.access" = { };

            "habitsync.access" = { };

            "grafana.access" = { };
            "grafana.admins" = { };

            "technitium.access" = { };
            "technitium.admins" = { };

            # POSIX (unix) login groups. POSIX *enablement* (gidnumber) is set
            # imperatively by the kanidm-posix oneshot — kanidm-provision cannot
            # manage POSIX attributes. These entries just ensure the groups exist
            # and carry membership.
            "${unix.groups.workstations.name}" = { };
            "${unix.groups.sysadmins.name}" = { };
          };

          persons = {
            "guest" = {
              displayName = "Guest Account";
              mailAddresses = [ "guest@a.plato-splunk.media" ];
              groups = [
                "radius.access"
                "radius.access_guest"
              ];
            };
            kaitlyn = {
              displayName = "Kaitlyn Hill";
              mailAddresses = [ "kaitlynxone@gmail.com" ];
              groups = [
                "radius.access"
                "radius.access_home"
                "planka.access"
                "planka.project_owner"
                "homelab.access"
                "habitsync.access"
              ];
            };
            jacob = {
              displayName = "Jacob Alford";
              mailAddresses = [ "jacob@plato-splunk.media" ];
              groups = [
                "radius.access"
                "radius.access_home"
                "radius.access_private"

                "openwebui.admins"
                "openwebui.access"

                "nextcloud.admins"
                "nextcloud.access"

                "jellyfin.admins"
                "jellyfin.access"

                "home-assistant.access"
                "home-assistant.admins"

                "planka.access"
                "planka.project_owner"
                "planka.admins"

                "step-ca.access"

                "homelab.admins"

                "grafana.access"
                "grafana.admins"

                "technitium.admins"
              ];
            };
            rae = {
              displayName = "Rae Hill";
              mailAddresses = [ "rae@plato-splunk.media" ];
              groups = [
                "radius.access"
                "radius.access_home"

                "openwebui.admins"
                "openwebui.access"

                "nextcloud.admins"
                "nextcloud.access"

                "jellyfin.admins"
                "jellyfin.access"

                "home-assistant.access"
                "home-assistant.admins"

                "planka.access"
                "planka.project_owner"
                "planka.admins"

                "step-ca.access"

                "homelab.admins"

                "habitsync.access"

                "grafana.access"
                "grafana.admins"

                "technitium.access"
                "technitium.admins"

                # POSIX (unix) login — workstation greeter + sudo via map_group.
                "${unix.groups.workstations.name}"
                "${unix.groups.sysadmins.name}"
              ];
            };
            "g1447dk9fp" = {
              displayName = "Rae's iPhone";
              mailAddresses = [ "G1447DK9FP@a.plato-splunk.media" ];
              groups = [
                "radius.access"
                "radius.access_admin"
              ];
            };
            "d2tn90jvjv" = {
              displayName = "Rae's iPad";
              mailAddresses = [ "D2TN90JVJV@a.plato-splunk.media" ];
              groups = [
                "radius.access"
                "radius.access_admin"
              ];
            };
            "c0wr4xr52g" = {
              displayName = "mini";
              mailAddresses = [ "C0WR4XR52G@a.plato-splunk.media" ];
              groups = [
                "radius.access"
                "radius.access_servers"
              ];
            };
            "grafana-mini" = {
              displayName = "mini";
              mailAddresses = [ "grafana-mini@a.plato-splunk.media" ];
              groups = [
                "grafana.access"
              ];
            };
          };
        };
      };

      services.caddy.virtualHosts."https://${svc.domain}" = {
        extraConfig = ''
          tls "${directory}/fullchain.pem" "${directory}/key.pem"
          tracing {
            span kanidm
          }
          reverse_proxy ${config.services.kanidm.provision.instanceUrl} {
            header_up HOST {host}
            transport http {
              tls_server_name ${svc.domain}
            }
          }
        '';
      };

      services.caddy.virtualHosts."http://${svc.domain}" = {
        extraConfig = ''
          reverse_proxy localhost:${builtins.toString svc.acmePort}
        '';
      };

      services.caddy.virtualHosts."http://${svc.ldapDomain}" = {
        extraConfig = ''
          reverse_proxy localhost:${builtins.toString svc.acmePort}
        '';
      };

      users.groups.idm.members = [
        "caddy"
        "kanidm"
      ];

      security.acme.certs."${svc.domain}" = {
        domain = svc.domain;
        listenHTTP = "127.0.0.1:${builtins.toString svc.acmePort}";
        server = c.ca.acmeDirectoryHttp;
        group = "idm";
        reloadServices = [
          "caddy.service"
          "kanidm.service"
        ];
      };

      services.restic.backups.kanidm = {
        user = "restic";
        repository = "/mnt/backups/kanidm";
        initialize = true;
        passwordFile = config.sops.templates."kanidm-backup-passphrase".path;
        paths = [ svc.backupPath ];
        timerConfig = {
          OnCalendar = "Mon..Sun *-*-* 23:30:00";
          Persistent = true;
        };
        package = pkgs.writeShellScriptBin "restic" ''
          exec /run/wrappers/bin/restic "$@"
        '';
      };

      systemd.services.kanidm.environment = {
        KANIDM_OTEL_GRPC_URL = "http://127.0.0.1:${toString c.services.tempo.grpcPort}";
      };

      services.failure-notifs.attachServices = [
        "kanidm"
        "restic-backups-kanidm"
        "kanidm-posix-provision"
      ];
    };
}
