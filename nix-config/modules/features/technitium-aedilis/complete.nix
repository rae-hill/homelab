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
          # Personal recursive resolver: recursion is open to ANY client. The
          # anti-abuse control is per-client QPM rate limiting (below) plus the
          # fact that plain plaintext DNS on 53 is firewalled off the public
          # internet (reachable only over Tailscale) — so public recursion is
          # available exclusively over the encrypted transports (DoH/DoT/DoQ),
          # which are connection-oriented/QUIC and not source-spoofable, defeating
          # UDP reflection/amplification. See docs/aedilis-host-plan.md §7a/§7b.
          mode = "Allow";
        };

        # DNSSEC validation on the recursive side (protects clients from forged /
        # poisoned upstream answers). This is the resolver's core safety control.
        dnssecValidation = true;

        # Per-client QPM rate limiting. With recursion now open to any client, this
        # is the primary abuse control: it caps per-client query rates so the open
        # recursive resolver can't be driven into reflection/amplification or DoS.
        # Over-limit UDP gets TC=1 (TCP retry) for 50%, the rest dropped.
        rateLimit = {
          enable = true;
          sampleMinutes = 5;
          udpTruncationPercentage = 50;
          ipv4 = [
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
          ipv6 = [
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
          # Dedicated least-privilege API user (created manually — see runbook). The
          # token broker logs in as this user; it holds Settings:Modify + Zones:Modify
          # only (NOT admin). The provisioner handles the settings + encrypted-DNS
          # steps, and now also the authoritative internal zone below.
          apiUser = "provisioner";
          apiPasswordFile = config.sops.secrets.technitium_provisioner_password.path;
          provisionDoTDoQCert = true;
          # Order the provisioner after the public DNS cert exists (needed for the
          # PKCS#12 conversion), without the generic module touching security.acme.
          certReadyUnits = [ "acme-${tech.domain}.service" ];

          # Host the internal plato-splunk.media zone authoritatively on this
          # recursive resolver. This replaces the former NextDNS "rewrites": the
          # server (and its DoH/DoT/DoQ clients) resolve these names from the local
          # Primary zone instead of recursing to public DNS. Critically, this is what
          # lets Technitium's own OIDC/SSO client reach `idm.plato-splunk.media` (a
          # tailnet-only name that would otherwise NXDOMAIN under public recursion).
          #
          # NOTE: a Primary zone is fully authoritative — any plato-splunk.media name
          # NOT in constants.dnsRecords.private returns NXDOMAIN (no public
          # fallthrough). This is intentional: we own the internal zone. The set
          # therefore includes the public endpoint names (dns, aedilis) so the
          # server's own public identity stays resolvable.
          ensureDnsRecords = {
            enable = true;
            zones = c.dnsRecords.private;
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
      inputs.self.modules.nixos.technitium-provisioning
      inputs.self.modules.nixos.technitium-aedilis-acme
      inputs.self.modules.nixos.technitium-aedilis-observability
      aedilisConfig
    ];
  };
}
