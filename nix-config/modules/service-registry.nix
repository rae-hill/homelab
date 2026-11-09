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
  #
  # NOTE: the former `tailnetRewrites` string map + `mkTailnetRecords`/`tailnetRecords` fold
  # have been REPLACED by `catalogDns` (below) — the typed, catalog-shaped DNS aggregate the
  # homelab-service-dns generator folds. The `ts` table remains (host-apex extras); service
  # records now come from `catalogDns`.

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

  # --- Non-service DNS extras (for the homelab-service-dns generator) ---------
  # The DNS generator folds service-derived records from catalog entries; these are
  # the records that have NO owning catalog service and must be supplied explicitly:
  #   - host apexes (the machines themselves): augustus/cicero/nixos/praeconinus
  #   - tailnet names with no catalog entry: ca (cicero step-ca), ollama (mini)
  #   - the nas LAN A record (no tailnet address, no AAAA)
  #   - the public OVH endpoint identities: dns, aedilis
  # A/AAAA for tailnet names come from `ts` (identical to constants.hosts.<h>.tailscale).
  # Keyed by zone, matching the generator's `extrasByZone` shape.
  mkTailnetApex =
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
  dnsExtraRecords = {
    "${baseDomain}" =
      # host apexes (self-names → own tailnet address)
      (mkTailnetApex "augustus" "augustus")
      ++ (mkTailnetApex "cicero" "cicero")
      ++ (mkTailnetApex "nixos" "nixos")
      ++ (mkTailnetApex "praeconinus" "praeconinus")
      ++ (mkTailnetApex "mini" "mini")
      # tailnet names with no catalog entry
      ++ (mkTailnetApex "ca" "cicero")
      ++ (mkTailnetApex "ollama" "mini")
      # nas LAN outlier (A only, no AAAA)
      ++ nasRecords
      # public OVH endpoint identities (dns, aedilis)
      ++ publicEndpointRecords;
  };

  # --- flake.catalogDns: global cross-host DNS aggregate for homelab-service-dns ----------
  # DNS is central (aedilis emits records for services on every host), but per-host
  # `homelab.catalog` entries are only visible on the host that imports them. So the service
  # DNS facts live here as ONE global, typed map the aedilis DNS generator folds (plus
  # dnsExtraRecords for non-service names). This replaces the old `tailnetRewrites` string map
  # with the catalog's attrTag record shape. Each service's features/<svc>/catalog.nix still
  # carries its own `dns`/`managedBy.dns` as declared intent; this aggregate is what the
  # generator actually reads (see features/homelab-service/dns.nix for why it cannot read the
  # per-host catalogs cross-host). subdomain/host match each service's catalog entry; `ldap`
  # and `apprise` are intentionally absent (operator-approved removals).
  mkCatalogDns = name: subdomain: host: {
    inherit subdomain host;
    zone = baseDomain;
    record.tailnet = { };
  };
  catalogDns = {
    # augustus services
    kanidm = mkCatalogDns "kanidm" "idm" "augustus";
    openwebui = mkCatalogDns "openwebui" "openwebui" "augustus";
    radius = mkCatalogDns "radius" "radius" "augustus";
    home-assistant = mkCatalogDns "home-assistant" "home-assistant" "augustus";
    it-tools = mkCatalogDns "it-tools" "dev-tools" "augustus";
    planka = mkCatalogDns "planka" "planka" "augustus";
    postgres = mkCatalogDns "postgres" "postgres-augustus" "augustus";
    homelab-api = mkCatalogDns "homelab-api" "homelab-api" "augustus";
    homelab-ui = mkCatalogDns "homelab-ui" "homelab" "augustus";
    resume-site = mkCatalogDns "resume-site" "resume" "augustus";
    habitsync = mkCatalogDns "habitsync" "habitsync" "augustus";
    prometheus = mkCatalogDns "prometheus" "prometheus" "augustus";
    prometheus-client = mkCatalogDns "prometheus-client" "prometheus-client" "augustus";
    grafana = mkCatalogDns "grafana" "grafana" "augustus";
    loki-push = mkCatalogDns "loki-push" "loki-push" "augustus";
    # cicero services
    cicero-metrics = mkCatalogDns "cicero-metrics" "cicero-metrics" "cicero";
    ca-monitoring = mkCatalogDns "ca-monitoring" "ca-monitoring" "cicero";
    # mini services
    mini-jellyfin = mkCatalogDns "mini-jellyfin" "jellyfin" "mini";
    mini-jellyfin-metrics = mkCatalogDns "mini-jellyfin-metrics" "mini-jellyfin-metrics" "mini";
    mini-caddy-metrics = mkCatalogDns "mini-caddy-metrics" "mini-caddy-metrics" "mini";
    # nixos services
    opencode = mkCatalogDns "opencode" "opencode" "nixos";
    # aedilis services
    dns-admin = mkCatalogDns "dns-admin" "dns-admin" "aedilis";
    dns-metrics = mkCatalogDns "dns-metrics" "dns-metrics" "aedilis";
  };
in
{
  # Global cross-host DNS aggregate (see homelab-service-dns generator).
  config.flake.catalogDns = catalogDns;

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

    # Non-service DNS records merged into the generated zone by homelab-service-dns.
    # (The former hand-maintained `dnsRecords.private` zone has been replaced by the
    # homelab-service-dns generator folding `flake.catalogDns` + these extras.)
    inherit dnsExtraRecords;

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
        # Tailnet-served build of the resume SPA (features/resume-site catalog entry):
        # browsable mirror of resume.rae-hill.dev AND the origin homelab-api's
        # headless chrome renders POST /resume/print from.
        resumeSiteUrl = mkUrl "resume";
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

      # opencode web UI (nixos workstation) — a loopback `opencode serve`
      # home-manager user service, reverse-proxied by Caddy (mTLS vhost,
      # tailscale0-only :443). Deliberately NOT opencode's default port 49374:
      # that's the channel default the shared background service (local TUI)
      # uses, and the standalone web server must not fight it.
      opencode = {
        subdomain = "opencode";
        domain = mkDomain "opencode";
        url = mkUrl "opencode";
        port = 49375;
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
