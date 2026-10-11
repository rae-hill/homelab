{ config, ... }:
let
  c = config.constants;
  tech = c.services.technitium;
in
{
  flake.modules.nixos.technitium-service =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      inherit (config.security.acme.certs."${tech.domain}") directory;
      stateDir = "/var/lib/technitium-dns-server";
      # PKCS#12 bundle (converted from the ACME PEM) used by the DoT/DoQ listener.
      pkcs12Path = "${stateDir}/dns.pfx";
    in
    {
      # Trust the limited metrics user bootstrap + the admin bootstrap via *_FILE env vars.
      services.technitium-dns-server = {
        enable = true;
        # We control the firewall explicitly in _private/aedilis/security.nix.
        openFirewall = false;
      };

      # Static user/group so the service can read sops secrets and ACME certs via
      # group ownership (upstream defaults to DynamicUser = true, which cannot).
      users.users.technitium = {
        isSystemUser = true;
        group = "technitium";
        home = stateDir;
      };
      users.groups.technitium = { };

      systemd.services.technitium-dns-server = {
        serviceConfig = {
          DynamicUser = lib.mkForce false;
          User = "technitium";
          Group = "technitium";
          StateDirectory = lib.mkForce "technitium-dns-server";
          # Allow binding privileged DNS/HTTP ports.
          AmbientCapabilities = [ "CAP_NET_BIND_SERVICE" ];
          CapabilityBoundingSet = [ "CAP_NET_BIND_SERVICE" ];
        };

        # First-boot bootstrap environment. NOTE: Technitium reads these ONLY when
        # no config file exists yet (first start). Subsequent changes made in the
        # UI/API persist in the state dir and are not reconciled from here.
        environment = {
          DNS_SERVER_DOMAIN = tech.domain;

          # Web console: loopback only, fronted by Caddy.
          DNS_SERVER_WEB_SERVICE_LOCAL_ADDRESSES = "127.0.0.1";
          DNS_SERVER_WEB_SERVICE_HTTP_PORT = toString tech.webHttpPort;
          DNS_SERVER_WEB_SERVICE_ENABLE_HTTPS = "false";
          DNS_SERVER_WEB_SERVICE_HTTP_TO_TLS_REDIRECT = "false";
          # Caddy on loopback is the only reverse proxy.
          DNS_SERVER_WEB_SERVICE_REVERSE_PROXY_ADDRESSES = "127.0.0.1";

          # DoH behind the TLS-terminating reverse proxy (Caddy) on TCP 80.
          DNS_SERVER_OPTIONAL_PROTOCOL_DNS_OVER_HTTP = "true";

          # Admin bootstrap password (first boot only).
          DNS_SERVER_ADMIN_PASSWORD_FILE = config.sops.secrets.technitium_admin_password.path;

          # Authoritative-only on plain UDP/53: recursion restricted to trusted ACLs
          # (Tailscale CGNAT + ULA + loopback). Prevents DNS amplification abuse.
          DNS_SERVER_RECURSION = "UseSpecifiedNetworkACL";
          DNS_SERVER_RECURSION_NETWORK_ACL = "100.64.0.0/10,fd7a:115c:a1e0::/48,127.0.0.1,::1";

          # OIDC/SSO against Kanidm (client registered on augustus).
          DNS_SERVER_SSO_ENABLED = "true";
          DNS_SERVER_SSO_AUTHORITY = "https://${c.idm.domain}/oauth2/openid/${tech.clientId}";
          DNS_SERVER_SSO_CLIENT_ID = tech.clientId;
          DNS_SERVER_SSO_CLIENT_SECRET_FILE = config.sops.secrets.technitium_sso_client_secret.path;
          DNS_SERVER_SSO_SCOPES = "openid,profile,email";
          DNS_SERVER_SSO_ALLOW_SIGNUP = "true";
          DNS_SERVER_SSO_ALLOW_SIGNUP_ONLY_FOR_MAPPED_USERS = "true";
          # Map the Kanidm "Administrators" remote group to the local one.
          DNS_SERVER_SSO_GROUP_MAP = "Administrators:Administrators";
        };

        # Start after the public ACME cert is available (used for DoT/DoQ PKCS#12).
        after = [ "acme-${tech.domain}.service" ];
        wants = [ "acme-${tech.domain}.service" ];
      };

      # Expose paths for the provisioning oneshot (§6) and PKCS#12 conversion.
      environment.etc."technitium/pkcs12-path".text = pkcs12Path;
    };
}
