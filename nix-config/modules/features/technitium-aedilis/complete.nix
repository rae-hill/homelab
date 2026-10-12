{ config, inputs, ... }:
let
  c = config.constants;
  tech = c.services.technitium;
  dnsMetrics = c.services.dns-metrics;

  # Option wiring for aedilis. Separate module function so it can read the
  # evaluated NixOS `config` (sops secret paths + ACME cert directories).
  aedilisConfig =
    { config, ... }:
    let
      metricsCertDir = config.security.acme.certs."${dnsMetrics.domain}".directory;
      adminCertDir = config.security.acme.certs."${tech.adminDomain}".directory;
      publicCertDir = config.security.acme.certs."${tech.domain}".directory;
    in
    {
      services.technitium-server-complete = {
        enable = true;
        domain = tech.domain;
        webHttpPort = tech.webHttpPort;
        preferIPv6 = true;

        adminPasswordFile = config.sops.secrets.technitium_admin_password.path;

        recursion = {
          mode = "UseSpecifiedNetworkACL";
          # Recursion only for trusted Tailscale networks (+ loopback). Public
          # clients get authoritative-only answers over all transports.
          networkACL = [
            "100.64.0.0/10"
            "fd7a:115c:a1e0::/48"
            "127.0.0.1"
            "::1"
          ];
        };

        oidc = {
          enable = true;
          authority = "https://${c.idm.domain}/oauth2/openid/${tech.clientId}";
          clientId = tech.clientId;
          clientSecretFile = config.sops.secrets.technitium_sso_client_secret.path;
          scopes = [
            "openid"
            "profile"
            "email"
          ];
          groupMap.Administrators = "Administrators";
          allowSignup = true;
          allowSignupOnlyForMappedUsers = true;
        };

        encryptedDns = {
          enable = true;
          certPemFile = "${publicCertDir}/fullchain.pem";
          certKeyFile = "${publicCertDir}/key.pem";
          pkcs12PasswordFile = config.sops.secrets.technitium_pkcs12_password.path;
          dohPort = tech.dohPort;
          dotPort = tech.dotPort;
          doqPort = tech.dotPort;
        };

        provision = {
          enable = true;
          provisionDoTDoQCert = true;
          metricsUser = {
            enable = true;
            username = "prometheus";
            passwordFile = config.sops.secrets.technitium_metrics_user_password.path;
            sessionTimeoutSeconds = 3600;
            totp.enable = true;
          };
        };

        caddy = {
          enable = true;
          adminDomain = tech.adminDomain;
          adminPort = tech.adminPort;
          adminCertPemFile = "${adminCertDir}/fullchain.pem";
          adminCertKeyFile = "${adminCertDir}/key.pem";
          metricsDomain = dnsMetrics.domain;
          metricsPort = dnsMetrics.port;
          metricsCertPemFile = "${metricsCertDir}/fullchain.pem";
          metricsCertKeyFile = "${metricsCertDir}/key.pem";
          metricsMtlsTrustPoolFile = c.ca.rootCert;
          nodeExporterPort = dnsMetrics.nodeExporterPort;
        };

        observability = {
          enable = true;
          nodeExporterPort = dnsMetrics.nodeExporterPort;
          lokiPushUrl = c.services.loki-push.url;
          lokiClientCertPemFile = "${metricsCertDir}/fullchain.pem";
          lokiClientCertKeyFile = "${metricsCertDir}/key.pem";
          lokiCaFile = c.ca.rootCert;
        };
      };
    };
in
{
  # Aedilis-specific Technitium deployment. Consumes the generic `technitium`
  # feature and the aedilis ACME + observability layers, and sets all
  # services.technitium-server-complete.* option values from constants + sops.
  flake.modules.nixos.technitium-aedilis = {
    imports = [
      inputs.self.modules.nixos.technitium
      inputs.self.modules.nixos.technitium-aedilis-acme
      inputs.self.modules.nixos.technitium-aedilis-observability
      aedilisConfig
    ];
  };
}
