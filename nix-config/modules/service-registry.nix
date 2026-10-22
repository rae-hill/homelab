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

  # --- Tailnet split-horizon DNS records (dnsRecords.private) -----------------
  # Per-host Tailscale addresses. Defined locally (not via config.constants.hosts)
  # to avoid a self-reference while config.constants is being constructed. These
  # MUST stay in sync with constants.hosts.<name>.tailscale.
  ts = {
    augustus.v4 = "100.95.250.77";
    augustus.v6 = "fd7a:115c:a1e0::6301:fa4d";
    cicero.v4 = "100.72.52.108";
    cicero.v6 = "fd7a:115c:a1e0::2801:3495";
    praeconinus.v4 = "100.111.235.57";
    praeconinus.v6 = "fd7a:115c:a1e0::b33a:eb39";
    nixos.v4 = "100.99.178.23";
    nixos.v6 = "fd7a:115c:a1e0::b01:b217";
    mini.v4 = "100.111.29.21";
    mini.v6 = "fd7a:115c:a1e0::db01:1d31";
    aedilis.v4 = "100.108.78.46";
    aedilis.v6 = "fd7a:115c:a1e0::b43a:4e2f";
  };

  # subdomain (under plato-splunk.media) -> host key in `ts`. Each entry becomes an
  # apex A + AAAA record (e.g. `idm.plato-splunk.media`). Reproduces the NextDNS
  # "rewrite" model for the exact service hostnames consumers use. No wildcards:
  # only the apex names are queried.
  tailnetRewrites = {
    idm = "augustus";
    ldap = "augustus";
    openwebui = "augustus";
    radius = "augustus";
    home-assistant = "augustus";
    dev-tools = "augustus";
    planka = "augustus";
    postgres-augustus = "augustus";
    augustus = "augustus";
    homelab-api = "augustus";
    homelab = "augustus";
    apprise = "augustus";
    habitsync = "augustus";
    prometheus = "augustus";
    grafana = "augustus";
    loki-push = "augustus";
    prometheus-client = "augustus";

    ca = "cicero";
    cicero = "cicero";
    cicero-metrics = "cicero";
    ca-monitoring = "cicero";

    nixos = "nixos";

    ollama = "mini";
    mini-caddy-metrics = "mini";
    mini-jellyfin-metrics = "mini";

    praeconinus = "praeconinus";

    dns-admin = "aedilis";
    dns-metrics = "aedilis";
  };

  # Build the apex A + AAAA records for one subdomain/host pair.
  mkTailnetRecords =
    subdomain: hostKey:
    let
      host = ts.${hostKey};
      apex = mkDomain subdomain;
    in
    [
      {
        A.name = apex;
        A.address = host.v4;
      }
      {
        AAAA.name = apex;
        AAAA.address = host.v6;
      }
    ];

  tailnetRecords = lib.concatLists (lib.mapAttrsToList mkTailnetRecords tailnetRewrites);

  # Non-Tailscale LAN outlier: nas is reachable on a private LAN v4 only (no tailnet
  # address, no AAAA). Kept separate from the ts-driven generation above.
  nasRecords = [
    {
      A.name = mkDomain "nas";
      A.address = "10.76.100.190";
    }
  ];

  # Public-facing names that must remain resolvable from this (now authoritative)
  # internal zone. Because `plato-splunk.media` is a Primary zone here, any name NOT
  # in the zone returns NXDOMAIN rather than falling through to public DNS — so the
  # server's own public endpoint identities (`dns`, `aedilis`) must be present,
  # pointing at the public OVH addresses (NOT the tailnet addresses). These are the
  # public DoH/DoT/DoQ endpoint and the host name.
  aedilisPublicV4 = "15.204.95.40";
  aedilisPublicV6 = "2604:2dc0:222::64d";
  publicEndpointRecords = lib.concatLists (
    map
      (subdomain: [
        {
          A.name = mkDomain subdomain;
          A.address = aedilisPublicV4;
        }
        {
          AAAA.name = mkDomain subdomain;
          AAAA.address = aedilisPublicV6;
        }
      ])
      [
        "dns"
        "aedilis"
      ]
  );
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

    # Kanidm POSIX (unix) identity provisioning. Kanidm uses a single
    # `gidnumber` per account/group that doubles as the UID for persons. We
    # allocate EXPLICIT numbers (rather than Kanidm's dynamic range) so UID/GID
    # are stable and documented. Range chosen in the recommended 65536–524287
    # band (leaves 1000–65535 for OS/local use). These are consumed by the
    # augustus-side POSIX-enablement oneshot (features/kanidm-posix) and must
    # stay consistent with any client-side `map_group` wiring.
    unix = {
      # POSIX login groups (gate + local-group extension targets).
      groups = {
        # Daily-use workstation login gate (pam_allowed_login_groups).
        workstations = {
          name = "unix.workstations";
          gidnumber = 65601;
        };
        # Maps onto local `wheel` (sudo) on clients.
        sysadmins = {
          name = "unix.sysadmins";
          gidnumber = 65602;
        };
      };
      # Per-person POSIX attributes. `gidnumber` doubles as the UID.
      persons = {
        rae = {
          name = "rae";
          gidnumber = 66001;
          shell = "/run/current-system/sw/bin/zsh";
        };
      };
    };

    # Shared source of truth for declaratively-provisioned authoritative DNS records
    # (consumed by hosts running the technitium-provisioning feature with
    # services.technitium-server-complete.provision.ensureDnsRecords.enable = true).
    #
    #   dnsRecords.public  — records for PUBLIC authoritative servers (public IPs).
    #   dnsRecords.private — records for PRIVATE (Tailscale) authoritative servers.
    #                        These point at tailnet 100.x / ULA addresses and are
    #                        NEVER published to Route53 — they only ever live here and
    #                        are served by tailnet-only hosts.
    #
    # Each host references the slice it serves, e.g.:
    #   provision.ensureDnsRecords.zones = config.constants.dnsRecords.private;
    # The attrset shape matches services.technitium-server-complete.provision
    #   .ensureDnsRecords.zones: { "<zone>" = { type?; useSoaSerialDateScheme?;
    #   records = [ { name; type; ttl?; <value fields> } ]; }; }
    dnsRecords = {
      public = { };
      private = {
        "${baseDomain}" = {
          type = "Primary";
          records = tailnetRecords ++ nasRecords ++ publicEndpointRecords;
        };
      };
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
        # Personal recursive DNS resolver (aedilis). Recursion is open to any
        # client (rate-limited); public plaintext 53 is firewalled off (Tailscale
        # only). Technitium natively terminates DoH/DoT/DoQ with a managed Let's
        # Encrypt cert for public recursion.
        subdomain = "dns";
        domain = mkDomain "dns";
        url = mkUrl "dns";
        clientId = "technitium";
        oidcEndpoint = mkOidcEndpoint "technitium";
        # DNS protocol ports. DoH/DoT/DoQ are public (Technitium-terminated); plain
        # 53 is Tailscale-only (firewalled off the public internet).
        dnsPort = 53; # plain DNS — Tailscale-only (see _private/aedilis/security.nix)
        dotPort = 853; # DNS-over-TLS (tcp) and DNS-over-QUIC (udp) — public
        dohPort = 443; # DNS-over-HTTPS (native TLS) — public
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
