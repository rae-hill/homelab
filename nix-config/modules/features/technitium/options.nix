{ ... }:
{
  # Option schema for the generic, reusable Technitium DNS server module.
  # Namespace: services.technitium-server-complete (distinct from upstream
  # services.technitium-dns-server). This module declares options only; the
  # service/provision/caddy modules consume them. All host-specific values
  # (domain, sops secret paths, ACME cert dirs, recursion ACL) are supplied by
  # the consuming layer (e.g. technitium-aedilis).
  flake.modules.nixos.technitium-options =
    { lib, ... }:
    let
      inherit (lib) mkOption mkEnableOption types;
    in
    {
      options.services.technitium-server-complete = {
        enable = mkEnableOption "homelab Technitium DNS server wrapper";

        domain = mkOption {
          type = types.str;
          description = "Primary FQDN the DNS server uses to identify itself (DNS_SERVER_DOMAIN).";
        };

        stateDir = mkOption {
          type = types.str;
          default = "/var/lib/technitium-dns-server";
          description = "Technitium state directory (holds config, zones, generated PKCS#12).";
        };

        user = mkOption {
          type = types.str;
          default = "technitium";
          description = "System user the service runs as (static, for secret/cert group access).";
        };

        group = mkOption {
          type = types.str;
          default = "technitium";
          description = "System group for the service (cert/secret read access).";
        };

        webHttpPort = mkOption {
          type = types.port;
          default = 5380;
          description = "Loopback plain-HTTP port for the web console (fronted by Caddy).";
        };

        adminPasswordFile = mkOption {
          type = types.path;
          description = "Path to a file with the admin web-console password (first-boot bootstrap).";
        };

        preferIPv6 = mkOption {
          type = types.bool;
          default = true;
          description = "Prefer IPv6 for outbound resolution (DNS_SERVER_PREFER_IPV6).";
        };

        recursion = {
          mode = mkOption {
            type = types.enum [
              "Deny"
              "Allow"
              "AllowOnlyForPrivateNetworks"
              "UseSpecifiedNetworkACL"
            ];
            default = "UseSpecifiedNetworkACL";
            description = ''
              Recursion policy (DNS_SERVER_RECURSION). With UseSpecifiedNetworkACL,
              recursion is restricted to `recursion.networkACL`; public clients get
              authoritative-only answers over all transports (anti-amplification).
            '';
          };

          networkACL = mkOption {
            type = types.listOf types.str;
            default = [ ];
            example = [
              "100.64.0.0/10"
              "fd7a:115c:a1e0::/48"
              "127.0.0.1"
              "::1"
            ];
            description = ''
              Network ACL entries for recursion (DNS_SERVER_RECURSION_NETWORK_ACL),
              joined to a comma-separated list. Prefix an entry with `!` to deny.
            '';
          };
        };

        oidc = {
          enable = mkEnableOption "Kanidm OIDC SSO for the admin web console";

          authority = mkOption {
            type = types.str;
            description = "OIDC issuer/authority URL (DNS_SERVER_SSO_AUTHORITY).";
          };

          clientId = mkOption {
            type = types.str;
            description = "OIDC client id (DNS_SERVER_SSO_CLIENT_ID).";
          };

          clientSecretFile = mkOption {
            type = types.path;
            description = "Path to a file containing the OIDC client secret.";
          };

          scopes = mkOption {
            type = types.listOf types.str;
            default = [
              "openid"
              "profile"
              "email"
            ];
            description = "OIDC scopes (DNS_SERVER_SSO_SCOPES), joined to CSV.";
          };

          groupMap = mkOption {
            type = types.attrsOf types.str;
            default = { };
            example = {
              Administrators = "Administrators";
            };
            description = ''
              Remote-group → local-group map (DNS_SERVER_SSO_GROUP_MAP), rendered as
              `remote:local` CSV entries.
            '';
          };

          allowSignup = mkOption {
            type = types.bool;
            default = true;
            description = "Allow auto-provisioning SSO users (DNS_SERVER_SSO_ALLOW_SIGNUP).";
          };

          allowSignupOnlyForMappedUsers = mkOption {
            type = types.bool;
            default = true;
            description = "Only allow SSO signup for users in a mapped group.";
          };
        };

        encryptedDns = {
          enable = mkEnableOption "DoH/DoT/DoQ with Technitium-native TLS termination";

          certPemFile = mkOption {
            type = types.path;
            description = "Path to the fullchain PEM used for DoH/DoT/DoQ (converted to PKCS#12).";
          };

          certKeyFile = mkOption {
            type = types.path;
            description = "Path to the private key PEM paired with certPemFile.";
          };

          pkcs12PasswordFile = mkOption {
            type = types.path;
            description = "Path to a file with the password protecting the generated PKCS#12 bundle.";
          };

          dohPort = mkOption {
            type = types.port;
            default = 443;
            description = "DNS-over-HTTPS port (DoH).";
          };

          dotPort = mkOption {
            type = types.port;
            default = 853;
            description = "DNS-over-TLS port (DoT, TCP).";
          };

          doqPort = mkOption {
            type = types.port;
            default = 853;
            description = "DNS-over-QUIC port (DoQ, UDP).";
          };
        };

        provision = {
          enable = mkOption {
            type = types.bool;
            default = true;
            description = "Run the API-driven provisioning oneshot after first start.";
          };

          provisionDoTDoQCert = mkOption {
            type = types.bool;
            default = true;
            description = ''
              Convert the encryptedDns cert to PKCS#12 and enable DoT/DoQ/DoH via the
              Technitium settings API. Only meaningful when encryptedDns.enable is set.
            '';
          };

          metricsUser = {
            enable = mkEnableOption "a limited Dashboard-view-only metrics user for Prometheus";

            username = mkOption {
              type = types.str;
              default = "prometheus";
              description = "Username for the limited metrics user.";
            };

            passwordFile = mkOption {
              type = types.path;
              description = "Path to a file with the metrics user's password.";
            };

            sessionTimeoutSeconds = mkOption {
              type = types.int;
              default = 3600;
              description = "Session timeout for the metrics user (login-token lifetime).";
            };

            totp = {
              enable = mkOption {
                type = types.bool;
                default = true;
                description = "Enable TOTP 2FA on the metrics user (server-generated seed).";
              };

              seedOutputPath = mkOption {
                type = types.str;
                default = "";
                description = ''
                  Where to persist the server-generated TOTP seed for out-of-band
                  transfer to the scraping host. Empty = `''${stateDir}/metrics-totp-seed`.
                '';
              };
            };
          };
        };

        caddy = {
          enable = mkEnableOption "Caddy vhosts for the admin UI and metrics endpoint";

          adminDomain = mkOption {
            type = types.str;
            description = "Hostname for the admin UI vhost (Tailscale-only, OIDC-gated, no mTLS).";
          };

          adminPort = mkOption {
            type = types.port;
            default = 8443;
            description = "HTTPS port Caddy serves the admin UI on.";
          };

          adminCertPemFile = mkOption {
            type = types.path;
            description = "step-ca fullchain PEM for the admin UI vhost TLS.";
          };

          adminCertKeyFile = mkOption {
            type = types.path;
            description = "step-ca key PEM for the admin UI vhost TLS.";
          };

          metricsDomain = mkOption {
            type = types.str;
            description = "Hostname for the metrics vhost (Tailscale-only, mTLS).";
          };

          metricsPort = mkOption {
            type = types.port;
            default = 9443;
            description = "HTTPS port Caddy serves the metrics endpoint on.";
          };

          metricsCertPemFile = mkOption {
            type = types.path;
            description = "step-ca fullchain PEM for the metrics vhost TLS.";
          };

          metricsCertKeyFile = mkOption {
            type = types.path;
            description = "step-ca key PEM for the metrics vhost TLS.";
          };

          metricsMtlsTrustPoolFile = mkOption {
            type = types.path;
            description = "Root CA PEM used for client-cert verification on the metrics vhost.";
          };

          nodeExporterPort = mkOption {
            type = types.port;
            default = 9100;
            description = "Loopback node_exporter port proxied under /metrics on the metrics vhost.";
          };
        };

        observability = {
          enable = mkEnableOption "node_exporter + Alloy journald log shipping";

          nodeExporterPort = mkOption {
            type = types.port;
            default = 9100;
            description = "node_exporter listen port (loopback).";
          };

          alloyPort = mkOption {
            type = types.port;
            default = 12345;
            description = "Alloy HTTP admin listen port (loopback).";
          };

          lokiPushUrl = mkOption {
            type = types.str;
            description = "Remote Loki push base URL (mTLS) for Alloy.";
          };

          lokiClientCertPemFile = mkOption {
            type = types.path;
            description = "Client cert PEM for the Loki push mTLS.";
          };

          lokiClientCertKeyFile = mkOption {
            type = types.path;
            description = "Client key PEM for the Loki push mTLS.";
          };

          lokiCaFile = mkOption {
            type = types.path;
            description = "CA file for verifying the remote Loki endpoint.";
          };
        };
      };
    };
}
