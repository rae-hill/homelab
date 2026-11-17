# Aedilis-specific Technitium deployment (moved from the former
# system-configs/aedilis/technitium.nix/). Imported at the flake-parts
# level by system-configs/aedilis/default.nix.
#
# Consumes the generic `technitium` feature and the aedilis ACME +
# observability layers, and sets all services.technitium-server-complete.*
# option values from constants + sops.
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
          # NOTE: a Primary zone is fully authoritative — any plato-splunk.media name
          # NOT in the record set returns NXDOMAIN (no public fallthrough). This is
          # intentional: we own the internal zone. The record set is now produced by the
          # `homelab-service-dns` generator (folds catalog entries with dns != null +
          # managedBy.dns, plus constants.dnsExtraRecords for non-service names). The
          # public endpoint names (dns, aedilis) are in dnsExtraRecords so the server's
          # own public identity stays resolvable.
          ensureDnsRecords.enable = true;
          # zones are set by the homelab-service-dns generator (NOT hand-listed here).
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
  # Host-level ACME base for aedilis's Technitium deployment. The three certs + their
  # HTTP-01 challenge vhosts (public LE dns cert, step-ca admin + metrics certs) now
  # come from the service catalog (the technitium-aedilis-catalog module below,
  # rendered by the acme generator). This module keeps only the `acme` base import +
  # the default CA selection (per-cert server/listenHTTP are set explicitly by the
  # generator, so the defaults only cover acceptTerms/email).
  flake.modules.nixos.technitium-aedilis-acme =
    { ... }:
    {
      imports = [ inputs.self.modules.nixos.acme ];

      # Default to internal step-ca; the public DNS cert overrides to Let's Encrypt per-cert.
      services.homelab-acme.defaultCA = "internal";
    };

  # Catalog entries: 3 ACME certs + their challenge vhosts + the admin & metrics
  # HTTPS vhosts.
  #
  # Three domains:
  #   - technitium (dns)   : PUBLIC Let's Encrypt cert for native DoH/DoT/DoQ termination
  #                          (consumed by the Technitium service, NOT Caddy). No Caddy
  #                          HTTPS vhost -> the entry owns the cert + its handle+redirect
  #                          challenge vhost only (clientCertOnly).
  #   - dns-admin          : step-ca cert + the admin UI HTTPS vhost (plain manual-TLS
  #                          reverse-proxy; OIDC-gated by Technitium itself, no mTLS).
  #   - dns-metrics        : step-ca cert + the mTLS + path-allowlist metrics HTTPS vhost
  #                          (bespoke body via backend.raw/extraCaddyConfig), + the Alloy
  #                          client cert consumer.
  #
  # The Technitium option module (services.technitium-server-complete.*) still PRODUCES
  # the cert-path option values; this entry feeds them into the catalog. The generic
  # networking-technitium/caddy.nix keeps only the host-level Caddy settings + the
  # cert-group->caddy membership (its two vhost bodies moved here).
  #
  # See docs/service-consolidation/technitium-aedilis.md + technitium-caddy.md.
  flake.modules.nixos.technitium-aedilis-catalog =
    { config, ... }:
    let
      cfg = config.services.technitium-server-complete;
      metricsCertDir = config.security.acme.certs."${dnsMetrics.domain}".directory;
    in
    {
      homelab.catalog = {
        # (1) Public DNS endpoint cert — Let's Encrypt, consumed by Technitium (no Caddy vhost).
        technitium = {
          subdomain = tech.subdomain; # "dns"
          host = "aedilis";
          clientCertOnly = true; # owns the cert + challenge, but NO Caddy https vhost
          backend.none = { };
          tls.cert.own = {
            ca = "letsencrypt";
            email = "rae@plato-splunk.media";
            acmePort = tech.acmePort; # 22482
            certGroup = cfg.group; # "technitium" — service reads it for PKCS#12 conversion
            reloadServices = [
              "technitium-dns-server.service"
              "technitium-provision.service"
            ]; # caddy.service prepended via reloadCaddy
            reloadCaddy = true;
            challenge = {
              via = "caddy80";
              body.handle.redirectToHttps = true; # handle challenge + redir to https
            };
          };
          access.scope.tailnet = { };
          dns = null; # dns A/AAAA stays in the authoritative zone fold until the DNS cutover
          managedBy.acme = true;
        };

        # (2) Admin UI vhost — step-ca cert, plain manual-TLS reverse-proxy (no mTLS).
        dns-admin = {
          subdomain = tech.adminSubdomain; # "dns-admin"
          host = "aedilis";
          listenPort = tech.adminPort; # 8443

          backend.reverseProxy.port = tech.webHttpPort; # 127.0.0.1:5380

          tls.cert.own = {
            ca = "internal";
            acmePort = tech.adminAcmePort; # 22483
            certGroup = cfg.certGroup; # "technitium-certs"
            reloadServices = [ ]; # caddy.service via reloadCaddy
            reloadCaddy = true;
            challenge = {
              via = "caddy80";
              body.bare = { }; # today's http://dns-admin vhost is a bare reverse_proxy
            };
          };
          # gate.none (default): renderer emits `tls <cert> <key>\nreverse_proxy 127.0.0.1:5380`.
          access.scope.tailnet = { };
          dns.tailnet = { }; # dns-admin A/AAAA (-> aedilis tailnet addr)
          managedBy = {
            caddy = true;
            acme = true;
            firewall = true;
            dns = true;
          };
        };

        # (3) Metrics vhost — step-ca cert, mTLS + path allowlist (bespoke body). Also the
        # Alloy client cert consumer.
        dns-metrics = {
          subdomain = dnsMetrics.subdomain; # "dns-metrics"
          host = "aedilis";
          listenPort = dnsMetrics.port; # 9443

          backend.raw = { }; # bespoke body supplied verbatim via extraCaddyConfig
          tls.cert.own = {
            ca = "internal";
            acmePort = dnsMetrics.acmePort; # 22481
            certGroup = cfg.certGroup; # "technitium-certs"
            reloadServices = [ "alloy.service" ]; # caddy.service via reloadCaddy
            reloadCaddy = true;
            challenge = {
              via = "caddy80";
              body.bare = { }; # today's http://dns-metrics vhost is a bare reverse_proxy
            };
          };
          access.scope.tailnet = { };
          dns.tailnet = { }; # dns-metrics A/AAAA (-> aedilis tailnet addr)

          # Verbatim reproduction of networking-technitium/caddy.nix's metrics vhost body:
          # explicit cert + mTLS client_auth + the tight path allowlist (@node /metrics,
          # @dns metrics, @login) + respond 404.
          extraCaddyConfig = ''
            tls ${metricsCertDir}/fullchain.pem ${metricsCertDir}/key.pem {
              client_auth {
                mode require_and_verify
                trust_pool file {
                  pem_file ${c.ca.rootCert}
                }
              }
            }

            @node path /metrics
            handle @node {
              reverse_proxy 127.0.0.1:${toString dnsMetrics.nodeExporterPort}
            }

            @dns path /api/dashboard/metrics/text
            handle @dns {
              reverse_proxy 127.0.0.1:${toString tech.webHttpPort}
            }

            # The scrape token is minted by augustus's technitium-metrics-token
            # oneshot via POST /api/user/login over this same mTLS vhost (the
            # token then authorizes the /api/dashboard/metrics/text scrape). The
            # login path must be allowlisted or Caddy returns 404 and the token
            # mint fails ("login request failed"), leaving the DNS scrape target
            # DOWN. Keep the allowlist tight — only the login endpoint, not all
            # of /api/* — since mTLS is the only gate in front of it.
            @login path /api/user/login
            handle @login {
              reverse_proxy 127.0.0.1:${toString tech.webHttpPort}
            }

            handle {
              respond 404
            }
          '';

          managedBy = {
            caddy = true;
            acme = true;
            firewall = true;
            dns = true;
          };
        };
      };
    };

  # Observability for aedilis: node_exporter (host metrics, scraped via the mTLS
  # Caddy metrics vhost) + Alloy (journald → augustus Loki push over mTLS).
  # Gated by services.technitium-server-complete.observability.enable.
  flake.modules.nixos.technitium-aedilis-observability =
    {
      config,
      lib,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      obs = cfg.observability;
      inherit (lib) mkIf;
    in
    {
      config = mkIf (cfg.enable && obs.enable) {
        services.prometheus.exporters.node = {
          enable = true;
          port = obs.nodeExporterPort;
          listenAddress = "127.0.0.1";
          enabledCollectors = [
            "systemd"
            "processes"
          ];
        };

        services.alloy = {
          enable = true;
          extraFlags = [
            "--server.http.listen-addr=127.0.0.1:${toString obs.alloyPort}"
            "--disable-reporting"
          ];
        };

        environment.etc."alloy/config.alloy".text = ''
          // Discover all systemd journal entries
          loki.source.journal "systemd" {
            relabel_rules = loki.relabel.journal.rules
            forward_to    = [loki.write.remote.receiver]
            max_age       = "12h"
          }

          // Relabel rules to extract useful metadata
          loki.relabel "journal" {
            forward_to = []

            rule {
              source_labels = ["__journal__systemd_unit"]
              target_label  = "unit"
            }

            rule {
              source_labels = ["__journal__hostname"]
              target_label  = "hostname"
            }

            rule {
              source_labels = ["__journal_priority_keyword"]
              target_label  = "syslevel"
            }

            rule {
              source_labels = ["__journal_container_name"]
              target_label  = "container"
            }

            rule {
              source_labels = ["__journal__transport"]
              target_label  = "transport"
            }
          }

          // Push logs to Augustus' Loki via mTLS
          loki.write "remote" {
            endpoint {
              url = "${obs.lokiPushUrl}/loki/api/v1/push"

              tls_config {
                ca_file     = "${obs.lokiCaFile}"
                cert_file   = "${obs.lokiClientCertPemFile}"
                key_file    = "${obs.lokiClientCertKeyFile}"
              }
            }
          }
        '';

        # Static user with group-based cert access (metrics cert owned by certGroup).
        systemd.services.alloy.serviceConfig = {
          DynamicUser = lib.mkForce false;
          User = "alloy";
          Group = "alloy";
          SupplementaryGroups = [
            "systemd-journal"
            cfg.certGroup
          ];
        };

        systemd.tmpfiles.rules = [
          "d /var/lib/alloy 0750 alloy alloy -"
          "Z /var/lib/alloy - alloy alloy -"
        ];

        users.users.alloy = {
          isSystemUser = true;
          group = "alloy";
        };
        users.groups.alloy = { };
      };
    };

  # Aggregate — the module aedilis/default.nix imports.
  flake.modules.nixos.technitium-aedilis = {
    imports = [
      inputs.self.modules.nixos.technitium
      inputs.self.modules.nixos.technitium-provisioning
      inputs.self.modules.nixos.technitium-aedilis-acme
      inputs.self.modules.nixos.technitium-aedilis-catalog
      inputs.self.modules.nixos.technitium-aedilis-observability
      aedilisConfig
    ];
  };
}
