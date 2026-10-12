{
  inputs,
  lib,
  config,
  ...
}:
let
  baseDomain = "plato-splunk.media";
  mkDomain = subdomain: "${subdomain}.${baseDomain}";
  mkUrl = subdomain: "https://${mkDomain subdomain}";
  mkInsecureUrl = subdomain: "http://${mkDomain subdomain}";
  certsDir = inputs.self + "/certs";
  idmDomain = mkDomain "idm";
  mkOidcEndpoint =
    clientId: "https://${idmDomain}/oauth2/openid/${clientId}/.well-known/openid-configuration";
in
{
  config.constants = {
    inherit baseDomain;

    certsDir = certsDir;

    ca = {
      domain = mkDomain "ca";
      url = mkUrl "ca";
      metricsPort = 8443;
      metricsPortInternal = 43379;
      metricsDomain = mkDomain "ca-monitoring";
      metricsBaseUrl = "https://${mkDomain "ca-monitoring"}:8443";
      metricsUrl = "https://${mkDomain "ca-monitoring"}:8443/metrics";
      acmeDirectory = "https://${mkDomain "ca"}/acme/acme/directory";
      acmeDirectoryHttp = "https://${mkDomain "ca"}/acme/http/directory";
      acmeDirectoryClients = "https://${mkDomain "ca"}/acme/eap/directory";
      rootCert = certsDir + "/alford-root.crt";
      rootCertDer = certsDir + "/alford-root.der";
      rootTrustStore = certsDir + "/alford-root-truststore.p12";
      intermediateCert = certsDir + "/intermediate_ca_2.crt";
      intermediateCertDer = certsDir + "/intermediate_ca_2.der";
      sshUserCaCert = certsDir + "/ssh_user_ca_key.pub";
    };

    acme.email = "web@jacob-alford.dev";

    idm = {
      domain = idmDomain;
      url = "https://${idmDomain}";
      inherit mkOidcEndpoint;
    };

    postgres = {
      domain = mkDomain "postgres-augustus";
      port = 5432;
    };

    services = {
      home-assistant = {
        subdomain = "home-assistant";
        domain = mkDomain "home-assistant";
        url = mkUrl "home-assistant";
        clientId = "home-assistant";
        port = 8123;
        configDir = "/var/lib/hass";
      };

      openwebui = {
        subdomain = "openwebui";
        domain = mkDomain "openwebui";
        url = mkUrl "openwebui";
        clientId = "openwebui";
        port = 19553;
        stateDir = "/var/lib/open-webui";
      };

      planka = {
        subdomain = "planka";
        domain = mkDomain "planka";
        url = mkUrl "planka";
        clientId = "planka";
        port = 1337;
        stateDir = "/var/lib/planka";
      };

      homelab = {
        subdomain = "homelab-api";
        domain = mkDomain "homelab-api";
        oidcEndpoint = mkOidcEndpoint "homelab";
        clientId = "homelab";
        url = mkUrl "homelab-api";
        frontendUrl = mkUrl "homelab";
        insecureUrl = mkInsecureUrl "homelab-api";
        port = 35427;
        hmacFileName = "hmac.secret";
      };

      apprise = {
        subdomain = "apprise";
        domain = mkDomain "apprise";
        url = mkUrl "apprise";
        port = 51571;
        stateDir = "/var/lib/apprise";
      };

      habitsync = {
        subdomain = "habitsync";
        domain = mkDomain "habitsync";
        url = mkUrl "habitsync";
        clientId = "habitsync";
        port = 6842;
        stateDir = "/var/lib/habitsync";
      };

      it-tools = {
        subdomain = "dev-tools";
        domain = mkDomain "dev-tools";
        url = mkUrl "dev-tools";
        port = 47309;
      };

      kanidm = {
        subdomain = "idm";
        domain = idmDomain;
        ldapDomain = mkDomain "ldap";
        backupPath = "/var/lib/kanidm/backups";
        acmePort = 64073;
      };

      radius = {
        subdomain = "radius";
        domain = mkDomain "radius";
        acmePort = 22378;
      };

      postgres = {
        subdomain = "postgres-augustus";
        domain = mkDomain "postgres-augustus";
        acmePort = 41872;
      };

      step-ca = {
        subdomain = "ca";
        domain = mkDomain "ca";
        clientId = "step-ca";
        port = 443;
      };

      prometheus = {
        subdomain = "prometheus";
        domain = mkDomain "prometheus";
        url = mkUrl "prometheus";
        port = 9090;
        stateDir = "/var/lib/prometheus2";
      };

      loki = {
        port = 3100;
        stateDir = "/var/lib/loki";
      };

      alloy = {
        port = 12345;
      };

      tempo = {
        port = 3200;
        grpcPort = 4317;
        stateDir = "/var/lib/tempo";
      };

      grafana = {
        subdomain = "grafana";
        domain = mkDomain "grafana";
        url = mkUrl "grafana";
        clientId = "grafana";
        port = 3000;
        stateDir = "/var/lib/grafana";
      };

      loki-push = {
        subdomain = "loki-push";
        domain = mkDomain "loki-push";
        url = mkUrl "loki-push";
      };

      cicero-metrics = {
        subdomain = "cicero-metrics";
        domain = mkDomain "cicero-metrics";
        url = mkUrl "cicero-metrics";
        port = 8443;
        acmePort = 22479;
      };

      prometheus-client = {
        subdomain = "prometheus-client";
        domain = mkDomain "prometheus-client";
        acmePort = 22480;
      };

      minecraft = {
        port = 25565;
        backupRepository = "/mnt/backups/minecraft-backup";
        stateDir = "/srv/minecraft";
      };

      ollama = {
        port = 11434;
      };

      unpoller = {
        port = 9130;
      };

      tailscale-metrics = {
        port = 5252;
      };

      wyoming = {
        whisperPort = 10300;
        piperPort = 10200;
      };

      technitium = {
        # Public authoritative/encrypted DNS endpoint (aedilis). Technitium natively
        # terminates DoH/DoT/DoQ with a managed Let's Encrypt cert.
        subdomain = "dns";
        domain = mkDomain "dns";
        url = mkUrl "dns";
        clientId = "technitium";
        oidcEndpoint = mkOidcEndpoint "technitium";
        # DNS protocol ports (all public, Technitium-terminated)
        dnsPort = 53;
        dotPort = 853; # DNS-over-TLS (tcp) and DNS-over-QUIC (udp)
        dohPort = 443; # DNS-over-HTTPS (native TLS)
        # Technitium web console — loopback plain HTTP, fronted by Caddy on adminPort.
        webHttpPort = 5380;
        # ACME http-01 challenge listener (loopback; Caddy proxies :80 to it).
        acmePort = 22482;
        # Admin UI vhost (Tailscale-only, OIDC-gated, no mTLS) on Caddy.
        adminSubdomain = "dns-admin";
        adminDomain = mkDomain "dns-admin";
        adminUrl = mkUrl "dns-admin";
        adminPort = 8443;
        adminAcmePort = 22483;
      };

      dns-metrics = {
        # Technitium metrics endpoint (aedilis), mTLS-guarded, scraped by augustus.
        # Tailscale-restricted; port is arbitrary (distinct from the 8443 admin UI).
        subdomain = "dns-metrics";
        domain = mkDomain "dns-metrics";
        url = mkUrl "dns-metrics";
        port = 9443;
        acmePort = 22481;
        # node_exporter on the aedilis host
        nodeExporterPort = 9100;
      };
    };
  };
}
