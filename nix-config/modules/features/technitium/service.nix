{ ... }:
{
  flake.modules.nixos.technitium-service =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      inherit (lib)
        mkIf
        optionalAttrs
        concatStringsSep
        mapAttrsToList
        ;

      boolStr = b: if b then "true" else "false";

      ssoEnv = optionalAttrs cfg.oidc.enable {
        DNS_SERVER_SSO_ENABLED = "true";
        DNS_SERVER_SSO_AUTHORITY = cfg.oidc.authority;
        DNS_SERVER_SSO_CLIENT_ID = cfg.oidc.clientId;
        DNS_SERVER_SSO_CLIENT_SECRET_FILE = cfg.oidc.clientSecretFile;
        DNS_SERVER_SSO_SCOPES = concatStringsSep "," cfg.oidc.scopes;
        DNS_SERVER_SSO_ALLOW_SIGNUP = boolStr cfg.oidc.allowSignup;
        DNS_SERVER_SSO_ALLOW_SIGNUP_ONLY_FOR_MAPPED_USERS = boolStr cfg.oidc.allowSignupOnlyForMappedUsers;
        DNS_SERVER_SSO_GROUP_MAP = concatStringsSep "," (
          mapAttrsToList (remote: local: "${remote}:${local}") cfg.oidc.groupMap
        );
      };

      recursionEnv = {
        DNS_SERVER_RECURSION = cfg.recursion.mode;
      }
      // optionalAttrs (cfg.recursion.mode == "UseSpecifiedNetworkACL") {
        DNS_SERVER_RECURSION_NETWORK_ACL = concatStringsSep "," cfg.recursion.networkACL;
      };
    in
    {
      config = mkIf cfg.enable {
        services.technitium-dns-server = {
          enable = true;
          # Firewall is controlled explicitly by the host (see _private/<host>/security.nix).
          openFirewall = false;
        };

        # Static user/group so the service can read sops secrets and the public DNS
        # cert via ownership (upstream defaults to DynamicUser = true, which cannot).
        users.users.${cfg.user} = {
          isSystemUser = true;
          group = cfg.group;
          home = cfg.stateDir;
        };
        users.groups.${cfg.group} = { };

        # Dedicated group for Caddy/Alloy-consumed ACME certs (admin + metrics), so
        # those services get cert read access without joining the service group.
        users.groups.${cfg.certGroup} = { };

        systemd.services.technitium-dns-server = {
          serviceConfig = {
            DynamicUser = lib.mkForce false;
            User = cfg.user;
            Group = cfg.group;
            StateDirectory = lib.mkForce "technitium-dns-server";
            # Allow binding privileged DNS/TLS ports (53, 443, 853).
            AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ];
            CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
            # The man page's recommended baseline for system services.
            # Don't exclude @resources: it contains the sched_* parameter
            # calls that the .NET PAL uses at startup (kills the CLR).
            SystemCallFilter = [ "@system-service" ];
            SystemCallErrorNumber = "EPERM";
            SystemCallArchitectures = "native";
          };

          # First-boot bootstrap environment. NOTE: Technitium reads these ONLY when
          # no config file exists yet (first start). Subsequent changes made in the
          # UI/API persist in the state dir and are not reconciled from here.
          environment = {
            DNS_SERVER_DOMAIN = cfg.domain;
            DNS_SERVER_PREFER_IPV6 = boolStr cfg.preferIPv6;

            # Web console: loopback plain HTTP only, fronted by Caddy (no native HTTPS).
            DNS_SERVER_WEB_SERVICE_LOCAL_ADDRESSES = "127.0.0.1";
            DNS_SERVER_WEB_SERVICE_HTTP_PORT = toString cfg.webHttpPort;
            DNS_SERVER_WEB_SERVICE_ENABLE_HTTPS = "false";
            DNS_SERVER_WEB_SERVICE_HTTP_TO_TLS_REDIRECT = "false";
            # Trust the loopback reverse proxy (Caddy) for real-client-IP headers.
            DNS_SERVER_WEB_SERVICE_REVERSE_PROXY_ADDRESSES = "127.0.0.1";

            # Admin bootstrap password (first boot only).
            DNS_SERVER_ADMIN_PASSWORD_FILE = cfg.adminPasswordFile;
          }
          // recursionEnv
          // ssoEnv;

          # If encrypted DNS is enabled, the public ACME cert must exist before the
          # provisioner converts it; ordering is handled in the aedilis layer via the
          # acme unit. The core service itself does not block on the cert.
        };
      };
    };
}
