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
          description = "System group the service runs under (service process group).";
        };

        certGroup = mkOption {
          type = types.str;
          default = "technitium-certs";
          description = ''
            Group that owns the Caddy/Alloy-consumed ACME certs (admin + metrics).
            Caddy and Alloy join this group so they can read the certs WITHOUT being
            members of the service `group` (which would otherwise grant them nothing
            useful but widens the blast radius). The service `user` reads the public
            DNS cert directly as the cert owner.
          '';
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

        dnssecValidation = mkOption {
          type = types.bool;
          default = true;
          description = ''
            Validate DNSSEC signatures on recursive answers (resolver side). Protects
            trusted clients from forged/poisoned upstream responses. Applied via the
            settings API during provisioning. Note: this is the VALIDATION side only;
            signing authoritative zones is a per-zone operation done when zones are
            created.
          '';
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

        rateLimit = {
          enable = mkEnableOption "per-client query-per-minute (QPM) rate limiting";

          sampleMinutes = mkOption {
            type = types.int;
            default = 5;
            description = "Sampling window in minutes for the QPM average (qpmLimitSampleMinutes).";
          };

          udpTruncationPercentage = mkOption {
            type = types.int;
            default = 50;
            description = ''
              Percentage of over-limit UDP requests answered with TC=1 (forcing a TCP
              retry) rather than dropped (qpmLimitUdpTruncationPercentage). Mitigates
              UDP reflection/amplification while keeping legitimate clients working.
            '';
          };

          ipv4 = mkOption {
            type = types.listOf (
              types.submodule {
                options = {
                  prefix = mkOption {
                    type = types.int;
                    description = "IPv4 prefix length the limit applies to (e.g. 32).";
                  };
                  udpLimit = mkOption {
                    type = types.int;
                    description = "Max UDP queries/min for a subnet of this prefix (0 = unlimited).";
                  };
                  tcpLimit = mkOption {
                    type = types.int;
                    description = "Max TCP queries/min for a subnet of this prefix (0 = unlimited).";
                  };
                };
              }
            );
            default = [
              {
                prefix = 32;
                udpLimit = 600;
                tcpLimit = 600;
              }
              {
                prefix = 24;
                udpLimit = 6000;
                tcpLimit = 6000;
              }
            ];
            description = "IPv4 QPM prefix limits (qpmPrefixLimitsIPv4), rendered as pipe-separated rows.";
          };

          ipv6 = mkOption {
            type = types.listOf (
              types.submodule {
                options = {
                  prefix = mkOption {
                    type = types.int;
                    description = "IPv6 prefix length the limit applies to (e.g. 64).";
                  };
                  udpLimit = mkOption {
                    type = types.int;
                    description = "Max UDP queries/min for a subnet of this prefix (0 = unlimited).";
                  };
                  tcpLimit = mkOption {
                    type = types.int;
                    description = "Max TCP queries/min for a subnet of this prefix (0 = unlimited).";
                  };
                };
              }
            );
            default = [
              {
                prefix = 64;
                udpLimit = 1200;
                tcpLimit = 1200;
              }
              {
                prefix = 56;
                udpLimit = 6000;
                tcpLimit = 6000;
              }
            ];
            description = "IPv6 QPM prefix limits (qpmPrefixLimitsIPv6), rendered as pipe-separated rows.";
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

          certReadyUnits = mkOption {
            type = types.listOf types.str;
            default = [ ];
            example = [ "acme-dns.example.com.service" ];
            description = ''
              Extra systemd units the provisioning oneshot should order `after` and
              `wants` — typically the ACME cert unit(s) that must produce the
              encrypted-DNS cert before the PKCS#12 conversion. Keeps the generic
              module decoupled from `security.acme` (the consuming layer supplies the
              exact unit names).
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
