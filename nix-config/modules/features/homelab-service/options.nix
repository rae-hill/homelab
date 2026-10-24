# Catalog schema for the service-consolidation feature.
#
# Defines `options.homelab.catalog.<name>` — a typed registry of externally-reachable
# services. Each service feature contributes ONE entry (features/<svc>/catalog.nix); the
# five generators (caddy/acme/firewall/dns/oidc) read the aggregate and render all
# cross-cutting networking config from the single declaration.
#
# See docs/service-consolidation/catalog-and-generators.md §2 for the authoritative design,
# and §7 / §7.8 for the operator-approved deviations baked in here (notably: the Caddy
# upstream token is standardized on 127.0.0.1, and `tls.challenge.body` selects the bare vs
# handle+redir challenge-vhost form — there is deliberately NO `extraChallengeDomains`).
#
# SCHEMA STYLE — attrTag discriminated unions (NOT enum+booleans). Every "variant with
# per-variant data" is modeled as a `types.attrTag`, so the Nix type system — not prose
# "Required when …" descriptions — enforces which fields are present for each variant. A
# value is `{ <tag> = { …fields… }; }` with exactly one tag. This makes illegal states
# unrepresentable (e.g. a reverseProxy backend cannot carry a `root`, an mTLS gate must
# carry a `trustPoolFile`, a shared-cert service has no `acmePort`). Optional concerns
# (dns, oidc) are `nullOr` — absence means "no record"/"no client", replacing the old
# `enable` booleans.
#
# Schema only — NO config. Published in both the nixos and darwin classes so `homelab.catalog`
# exists on every host that might contribute or read an entry.
{ config, ... }@topLevel:
let
  sharedSchema =
    lib:
    let
      inherit (lib) mkOption types;
      c = topLevel.config.constants;
      hostNames = lib.attrNames c.hosts;

      # ----------------------------------------------------------------------------------
      # backend — what the vhost body serves. attrTag: exactly one of the four shapes.
      #   reverseProxy -> `reverse_proxy 127.0.0.1:<port>` (the common app case).
      #   static       -> `root * <root>` + Cache-Control header + `file_server` (homelab-ui).
      #   none         -> emit no backend directive (metrics-only / body-only vhost, or a
      #                   cert-terminating service with no HTTP vhost). Body (if any) comes
      #                   from extraCaddyConfig.
      #   raw          -> suppress ALL auto directives (backend, tls line, tracing); emit ONLY
      #                   extraCaddyConfig verbatim (kanidm transport, praeconinus routing).
      # ----------------------------------------------------------------------------------
      backendType = types.attrTag {
        reverseProxy = mkOption {
          description = "`reverse_proxy 127.0.0.1:<port>` — the common app case.";
          type = types.submodule {
            options.port = mkOption {
              type = types.port;
              description = "Loopback port the app listens on.";
            };
          };
        };
        static = mkOption {
          description = "`root * <root>` + Cache-Control header + `file_server` (homelab-ui).";
          type = types.submodule {
            options.root = mkOption {
              type = types.path;
              description = "Static site root (a package/derivation).";
            };
          };
        };
        none = mkOption {
          description = ''
            No backend directive. For a cert-terminating service with no HTTP vhost
            (postgres, radius) or a metrics-only body supplied via extraCaddyConfig.
          '';
          type = types.submodule { options = { }; };
        };
        raw = mkOption {
          description = ''
            Suppress ALL auto directives (backend, tls line, tracing); emit ONLY
            extraCaddyConfig verbatim (kanidm TLS-upstream transport, praeconinus routing).
          '';
          type = types.submodule { options = { }; };
        };
      };

      # ----------------------------------------------------------------------------------
      # challenge.body — the `http://<fqdn>` ACME HTTP-01 challenge-vhost body form. attrTag:
      #   handle -> `handle /.well-known/acme-challenge/* { reverse_proxy 127.0.0.1:<p> }`,
      #             optionally followed by a `handle { redir https://<fqdn>{uri} }` block.
      #   bare   -> the whole `http://` vhost is a bare `reverse_proxy 127.0.0.1:<p>`
      #             (today's kanidm/postgres/radius/technitium/cicero bodies).
      # ----------------------------------------------------------------------------------
      challengeBodyType = types.attrTag {
        handle = mkOption {
          description = "`handle /.well-known/acme-challenge/* { … }`, optional HTTPS redirect.";
          type = types.submodule {
            options.redirectToHttps = mkOption {
              type = types.bool;
              default = false;
              description = ''
                Append a `handle { redir https://<fqdn>{uri} }` block after the challenge
                handle — reproduces today's public `dns` vhost (technitium-aedilis).
              '';
            };
          };
        };
        bare = mkOption {
          description = "The whole `http://` vhost is a bare `reverse_proxy 127.0.0.1:<acmePort>`.";
          type = types.submodule { options = { }; };
        };
      };

      challengeType = types.submodule {
        options = {
          via = mkOption {
            type = types.enum [
              "caddy80"
              "direct"
            ];
            default = "caddy80";
            description = ''
              How the ACME HTTP-01 challenge is reached:
                "caddy80" -> loopback acmePort fronted by Caddy on :80 (no firewall opening).
                "direct"  -> the ACME server connects straight to acmePort (needs a firewall
                             opening on `iface`). The aedilis internal-CA tailnet certs.
            '';
          };
          iface = mkOption {
            type = types.enum [
              "public"
              "tailscale0"
            ];
            default = "tailscale0";
            description = ''
              Interface the direct-challenge opening lives on. Only consulted when
              via == "direct". "public" -> networking.firewall.allowedTCPPorts;
              "tailscale0" -> networking.firewall.interfaces.tailscale0.allowedTCPPorts.
            '';
          };
          body = mkOption {
            type = challengeBodyType;
            default = {
              handle = { };
            };
            description = "Challenge-vhost body form for the `http://<fqdn>` vhost (attrTag).";
          };
        };
      };

      # ----------------------------------------------------------------------------------
      # tls.cert — does this service terminate its OWN manual ACME cert, or share Caddy's
      # managed cert? attrTag:
      #   shared -> no security.acme.certs entry; shares Caddy's managed cert (the common
      #             reverse-proxy case). No cert fields at all.
      #   own    -> this service owns a security.acme.certs.<fqdn> entry. ALL the cert-only
      #             fields (acmePort, ca, email, certGroup, reload*, postRun, challenge) live
      #             INSIDE this variant, so they cannot be set for a shared-cert service.
      # ----------------------------------------------------------------------------------
      certType = types.attrTag {
        shared = mkOption {
          description = ''
            Shares Caddy's managed cert — no security.acme.certs entry (the common
            reverse-proxy case). Carries no cert fields.
          '';
          type = types.submodule { options = { }; };
        };
        own = mkOption {
          description = "Service terminates its OWN manual ACME cert (security.acme.certs.<fqdn>).";
          type = types.submodule (
            { name, ... }:
            {
              options = {
                ca = mkOption {
                  type = types.enum [
                    "internal"
                    "letsencrypt"
                  ];
                  default = "internal";
                  description = ''
                    Cert authority:
                      "internal"    -> homelab step-ca (server = ca.acmeDirectoryHttp).
                      "letsencrypt" -> public Let's Encrypt.
                  '';
                };
                acmePort = mkOption {
                  type = types.port;
                  description = "Loopback HTTP-01 listener port (security.acme.certs.<d>.listenHTTP).";
                };
                email = mkOption {
                  type = types.nullOr types.str;
                  default = null;
                  description = "Per-cert ACME contact email (e.g. the public LE dns cert). Null uses the acme default.";
                };
                certGroup = mkOption {
                  type = types.str;
                  description = ''
                    Per-service cert group that Caddy (and any reloaders) join to read the cert.
                    Per-service (NOT shared). Conventionally the service name.
                  '';
                };
                reloadServices = mkOption {
                  type = types.listOf types.str;
                  default = [ ];
                  description = ''
                    Extra systemd units to reload on renewal (e.g. "kanidm.service"). The caddy
                    generator prepends "caddy.service" ONLY when reloadCaddy is true.
                  '';
                };
                reloadCaddy = mkOption {
                  type = types.bool;
                  default = true;
                  description = ''
                    Whether to prepend "caddy.service" to reloadServices. True for certs a Caddy
                    vhost names (kanidm, technitium admin/metrics). False for certs consumed only
                    by a non-Caddy process (postgres postRun, radius container, prometheus/alloy
                    client certs) — those reload their own consumer via reloadServices instead.
                  '';
                };
                postRun = mkOption {
                  type = types.nullOr types.str;
                  default = null;
                  description = "security.acme.certs.<d>.postRun hook (postgres uses this instead of reloadServices).";
                };
                challenge = mkOption {
                  type = challengeType;
                  default = { };
                  description = "How/where the HTTP-01 challenge is reached (drives the firewall + challenge vhost).";
                };
              };
            }
          );
        };
      };

      # ----------------------------------------------------------------------------------
      # tls.gate — Caddy-level access gate woven into the vhost body. attrTag:
      #   none          -> no Caddy auth.
      #   oidc          -> app-handled OIDC (no extra Caddy config; documentation only).
      #   mtls          -> `tls … { client_auth require_and_verify; trust_pool … }`.
      #   mtlsAllowlist -> mTLS plus a path allowlist supplied via extraCaddyConfig (the
      #                    auto backend block is suppressed — the allowlist IS the body).
      # The mTLS variants carry the required trustPoolFile, so it cannot be omitted for an
      # mTLS gate nor set for a non-mTLS one.
      # ----------------------------------------------------------------------------------
      gateType = types.attrTag {
        none = mkOption {
          description = "No Caddy auth.";
          type = types.submodule { options = { }; };
        };
        oidc = mkOption {
          description = "App-handled OIDC (no extra Caddy config; documentation only).";
          type = types.submodule { options = { }; };
        };
        mtls = mkOption {
          description = "`tls … { client_auth require_and_verify; trust_pool … }`.";
          type = types.submodule {
            options.trustPoolFile = mkOption {
              type = types.path;
              description = "PEM trust pool for client_auth.";
            };
          };
        };
        mtlsAllowlist = mkOption {
          description = "mTLS plus a path allowlist supplied via extraCaddyConfig (backend suppressed).";
          type = types.submodule {
            options.trustPoolFile = mkOption {
              type = types.path;
              description = "PEM trust pool for client_auth.";
            };
          };
        };
      };

      tlsType = types.submodule {
        options = {
          cert = mkOption {
            type = certType;
            default = {
              shared = { };
            };
            description = "Whether the service owns its own ACME cert or shares Caddy's (attrTag).";
          };
          gate = mkOption {
            type = gateType;
            default = {
              none = { };
            };
            description = "Caddy-level access gate woven into the vhost body (attrTag).";
          };
        };
      };

      # ----------------------------------------------------------------------------------
      # access.scope — allowed source scope, drives the firewall interface. attrTag:
      #   public   -> public interface (allowedTCPPorts).
      #   tailnet  -> tailscale0 interface.
      #   hostList -> tailscale0 interface; carries `fromHosts` (the permitted peers —
      #               DECLARED INTENT ONLY today; the host firewall is inbound-only and this
      #               repo does not own the tailnet ACL). Captured for future headscale ACLs.
      #   funnel   -> Tailscale Funnel ingress (tailscaled owns :443; Caddy listens on
      #               listenPort e.g. 8443; NO firewall opening — praeconinus).
      #   none     -> no inbound opening generated.
      # ----------------------------------------------------------------------------------
      scopeType = types.attrTag {
        public = mkOption {
          description = "Public interface (allowedTCPPorts).";
          type = types.submodule { options = { }; };
        };
        tailnet = mkOption {
          description = "tailscale0 interface.";
          type = types.submodule { options = { }; };
        };
        hostList = mkOption {
          description = "tailscale0 interface, restricted to `fromHosts` (declared intent only).";
          type = types.submodule {
            options.fromHosts = mkOption {
              type = types.listOf (types.enum hostNames);
              default = [ ];
              description = ''
                Peer hosts permitted to reach the service. DECLARED INTENT ONLY — the host
                firewall is inbound-only and this repo does not own the tailnet ACL. Captured
                for the future headscale DERP ACLs; not auto-applied.
              '';
            };
          };
        };
        funnel = mkOption {
          description = "Tailscale Funnel ingress (tailscaled owns :443; NO firewall opening).";
          type = types.submodule { options = { }; };
        };
        none = mkOption {
          description = "No inbound opening generated.";
          type = types.submodule { options = { }; };
        };
      };

      accessType = types.submodule {
        options.scope = mkOption {
          type = scopeType;
          default = {
            tailnet = { };
          };
          description = "Allowed source scope; drives the firewall interface (attrTag).";
        };
      };

      # ----------------------------------------------------------------------------------
      # dns — the authoritative DNS record (emitted on aedilis). attrTag:
      #   tailnet -> A/AAAA from constants.hosts.<host>.tailscale.{v4,v6}.
      #   cname   -> a CNAME (carries `target`).
      #   public  -> public A/AAAA (carries `v4` + `v6`).
      # The whole `dns` field is `nullOr`: null means NO record (replaces the old `enable`
      # boolean). A set value is exactly one of the three record kinds.
      # ----------------------------------------------------------------------------------
      dnsRecordType = types.attrTag {
        tailnet = mkOption {
          description = "A/AAAA from constants.hosts.<host>.tailscale.{v4,v6}.";
          type = types.submodule { options = { }; };
        };
        cname = mkOption {
          description = "A CNAME record.";
          type = types.submodule {
            options.target = mkOption {
              type = types.str;
              description = "CNAME target FQDN.";
            };
          };
        };
        public = mkOption {
          description = "Public A/AAAA record.";
          type = types.submodule {
            options = {
              v4 = mkOption {
                type = types.str;
                description = "Public IPv4.";
              };
              v6 = mkOption {
                type = types.str;
                description = "Public IPv6.";
              };
            };
          };
        };
      };

      # ----------------------------------------------------------------------------------
      # oidc.client — public (PKCE, no secret) vs basic (basicSecretFile from secretRef).
      # attrTag: the basic variant carries the required `secretRef`, so a public client
      # cannot carry a secret and a basic client cannot omit one.
      # ----------------------------------------------------------------------------------
      oidcClientType = types.attrTag {
        public = mkOption {
          description = "Public client (PKCE, no secret).";
          type = types.submodule { options = { }; };
        };
        basic = mkOption {
          description = "Basic client (basicSecretFile from a sops secret).";
          type = types.submodule {
            options.secretRef = mkOption {
              type = types.str;
              description = ''
                sops secret NAME providing basicSecretFile. The generator references
                config.sops.secrets.<secretRef>.path; the secret is declared in the host
                sops config.
              '';
            };
          };
        };
      };

      # ----------------------------------------------------------------------------------
      # oidc — a Kanidm OIDC client (registered on augustus). The whole field is `nullOr`:
      # null means NO client (replaces the old `enable` boolean).
      # ----------------------------------------------------------------------------------
      oidcType = types.submodule (
        { ... }:
        {
          options = {
            clientId = mkOption {
              type = types.nullOr types.str;
              default = null;
              description = "OAuth2 client id. Defaults to the catalog entry name.";
            };
            client = mkOption {
              type = oidcClientType;
              description = "Public (PKCE) vs basic (secret) client (attrTag).";
            };
            callbackPath = mkOption {
              type = types.either types.str (types.listOf types.str);
              description = ''
                Redirect/callback path(s) appended to the service url to form originUrl. A list
                supports multiple callbacks. Entries beginning with a scheme (contain "://") are
                treated as ABSOLUTE and used verbatim (e.g. http://localhost:4321/oauth/callback,
                habitsync://auth-callback).
              '';
            };
            landingPath = mkOption {
              type = types.str;
              default = "/";
              description = "Landing path appended to the service url to form originLanding (use \"\" for the bare origin).";
            };
            displayName = mkOption {
              type = types.str;
              description = "Human-facing client name shown in Kanidm.";
            };
            allowInsecureClientDisablePkce = mkOption {
              type = types.bool;
              default = false;
              description = "Pass-through for basic clients that cannot do PKCE (e.g. planka).";
            };
            scopeMaps = mkOption {
              type = types.attrsOf (types.listOf types.str);
              default = { };
              description = "Kanidm scopeMaps, passed through verbatim (service-specific).";
            };
            claimMaps = mkOption {
              type = types.attrs;
              default = { };
              description = "Kanidm claimMaps, passed through verbatim (service-specific).";
            };
          };
        }
      );

      managedByType = types.submodule {
        options = {
          caddy = mkOption {
            type = types.bool;
            default = false;
            description = "Let the caddy generator own this entry's vhost.";
          };
          acme = mkOption {
            type = types.bool;
            default = false;
            description = "Let the acme generator own this entry's cert.";
          };
          firewall = mkOption {
            type = types.bool;
            default = false;
            description = "Let the firewall generator own this entry's openings.";
          };
          dns = mkOption {
            type = types.bool;
            default = false;
            description = "Let the dns generator own this entry's record.";
          };
          oidc = mkOption {
            type = types.bool;
            default = false;
            description = "Let the oidc generator own this entry's client.";
          };
        };
      };

      entryType = types.submodule (
        { config, ... }:
        {
          options = {
            subdomain = mkOption {
              type = types.str;
              description = "Left-most label; fqdn = <subdomain>.<zone>.";
            };
            zone = mkOption {
              type = types.str;
              default = c.baseDomain;
              description = "Base zone. fqdn/url derive from <subdomain>.<zone>. Default baseDomain.";
            };
            host = mkOption {
              type = types.enum hostNames;
              description = ''
                Which host runs the service. Binds the DNS record target and scopes the
                caddy/acme/firewall generators (host == networking.hostName).
              '';
            };
            listenPort = mkOption {
              type = types.port;
              default = 443;
              description = "Port Caddy listens on for this vhost. 443 normally; 8443 for Funnel.";
            };
            insecureHttp = mkOption {
              type = types.bool;
              default = false;
              description = ''
                Also emit a sibling `http://<fqdn>` vhost with the SAME body (homelab-api's
                insecureUrl). Only meaningful for the nixos caddy backend.
              '';
            };
            clientCertOnly = mkOption {
              type = types.bool;
              default = false;
              description = ''
                The entry owns a cert (+ its challenge vhost + DNS) but serves NO https vhost —
                the cert is consumed outbound by a non-Caddy process (prometheus-client, cicero
                alloy client cert). The caddy generator emits no https vhost for it.
              '';
            };
            backend = mkOption {
              type = backendType;
              default = {
                reverseProxy.port = 80;
              };
              description = "Upstream the vhost serves (attrTag: reverseProxy / static / none / raw).";
            };
            tracing = mkOption {
              type = types.submodule {
                options.enable = mkOption {
                  type = types.bool;
                  default = false;
                  description = ''
                    Emit a `tracing { span <name> }` block in the vhost (gated additionally on
                    the host's services.tempo.enable). Only the services that explicitly added a
                    span today (kanidm, loki-push, homelab-api, homelab-ui) set this.
                  '';
                };
              };
              default = { };
              description = "Caddy tracing span for this vhost (opt-in; matches current per-service spans).";
            };
            tls = mkOption {
              type = tlsType;
              default = { };
              description = "TLS/ACME (cert ownership) + Caddy access gate.";
            };
            access = mkOption {
              type = accessType;
              default = { };
              description = "Source scope / firewall.";
            };
            dns = mkOption {
              type = types.nullOr dnsRecordType;
              default = null;
              description = ''
                Authoritative DNS record (attrTag: tailnet / cname / public). null -> no record.
              '';
            };
            oidc = mkOption {
              type = types.nullOr oidcType;
              default = null;
              description = "Kanidm OIDC client. null -> no client.";
            };

            extraCaddyConfig = mkOption {
              type = types.lines;
              default = "";
              description = ''
                Free-form Caddyfile directives appended to the vhost body (or, with
                backend == { raw = { }; }, the entire body). Escape hatch for bespoke cases.
              '';
            };

            managedBy = mkOption {
              type = managedByType;
              default = { };
              description = ''
                Per-entry migration opt-in. Each generator only acts on entries where its
                managedBy.<concern> is true, so hand-written and generated config never both
                fire for one service. Flipped true as each service migrates.
              '';
            };

            fqdn = mkOption {
              type = types.str;
              readOnly = true;
              description = "<subdomain>.<zone>.";
            };
            url = mkOption {
              type = types.str;
              readOnly = true;
              description = "https://<fqdn>.";
            };
          };
          config = {
            fqdn = "${config.subdomain}.${config.zone}";
            url = "https://${config.subdomain}.${config.zone}";
          };
        }
      );
    in
    {
      options.homelab.catalog = mkOption {
        type = types.attrsOf entryType;
        default = { };
        description = ''
          Registry of externally-reachable services. One entry per service, contributed by
          that service's own feature (features/<service>/catalog.nix). Consumed by the five
          generators (caddy/acme/firewall/dns/oidc).
        '';
      };
    };
in
{
  flake.modules.nixos.homelab-catalog-options = { lib, ... }: sharedSchema lib;
  flake.modules.darwin.homelab-catalog-options = { lib, ... }: sharedSchema lib;
}
