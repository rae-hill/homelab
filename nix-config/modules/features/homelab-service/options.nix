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
# Schema only — NO config. Published in both the nixos and darwin classes so `homelab.catalog`
# exists on every host that might contribute or read an entry.
{ config, ... }@topLevel:
let
  sharedSchema =
    lib:
    let
      inherit (lib) mkOption mkEnableOption types;
      c = topLevel.config.constants;
      hostNames = lib.attrNames c.hosts;

      backendType = types.submodule {
        options = {
          kind = mkOption {
            type = types.enum [
              "reverseProxy"
              "static"
              "none"
              "raw"
            ];
            description = ''
              What the vhost body serves:
                "reverseProxy" -> `reverse_proxy 127.0.0.1:<port>` (the common app case).
                "static"       -> `root * <root>` + the Cache-Control header + `file_server`
                                  (the homelab-ui frontend case).
                "none"         -> emit no backend directive (metrics-only / body-only vhost,
                                  e.g. ca-monitoring, mini-caddy-metrics). Body comes from
                                  extraCaddyConfig.
                "raw"          -> suppress ALL auto directives (backend, tls line, tracing);
                                  emit ONLY extraCaddyConfig verbatim. For bespoke bodies
                                  (kanidm's TLS-upstream transport, technitium metrics
                                  allowlist, praeconinus base-path routing).
            '';
          };
          port = mkOption {
            type = types.nullOr types.port;
            default = null;
            description = "Loopback port the app listens on. Required when kind == reverseProxy.";
          };
          root = mkOption {
            type = types.nullOr types.path;
            default = null;
            description = "Static site root (a package/derivation). Required when kind == static.";
          };
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
            type = types.enum [
              "handle"
              "bare"
            ];
            default = "handle";
            description = ''
              Challenge-vhost body form for the `http://<fqdn>` vhost:
                "handle" -> `handle /.well-known/acme-challenge/* { reverse_proxy 127.0.0.1:<p> }`
                            (the generator's default).
                "bare"   -> the whole `http://` vhost is a bare `reverse_proxy 127.0.0.1:<p>`
                            (matches today's kanidm/postgres/radius/technitium/cicero bodies).
            '';
          };
          redirectToHttps = mkOption {
            type = types.bool;
            default = false;
            description = ''
              When true (and body == "handle"), append a `handle { redir https://<fqdn>{uri} }`
              block after the challenge handle — reproduces today's public `dns` vhost
              (technitium-aedilis).
            '';
          };
        };
      };

      tlsType = types.submodule {
        options = {
          ca = mkOption {
            type = types.nullOr (
              types.enum [
                "internal"
                "letsencrypt"
              ]
            );
            default = null;
            description = ''
              Cert authority for a service that terminates its OWN manual TLS cert:
                "internal"    -> homelab step-ca (security.acme.certs server = ca.acmeDirectoryHttp).
                "letsencrypt" -> public Let's Encrypt.
                null          -> no security.acme.certs entry; shares Caddy's managed cert
                                 (the common reverse-proxy case).
            '';
          };
          acmePort = mkOption {
            type = types.nullOr types.port;
            default = null;
            description = "Loopback HTTP-01 listener port. Required when ca != null.";
          };
          email = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "Per-cert ACME contact email (e.g. the public LE dns cert). Null uses the acme default.";
          };
          certGroup = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = ''
              Per-service cert group that Caddy (and any reloaders) join to read the cert.
              Defaults to the service name. Per-service (NOT shared).
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
          gate = mkOption {
            type = types.enum [
              "none"
              "oidc"
              "mtls"
              "mtls+allowlist"
            ];
            default = "none";
            description = ''
              Caddy-level access gate woven into the vhost body:
                "none"           -> no Caddy auth.
                "oidc"           -> app-handled OIDC (no extra Caddy config; documentation only).
                "mtls"           -> `tls … { client_auth require_and_verify; trust_pool … }`.
                "mtls+allowlist" -> mTLS plus a path allowlist supplied via extraCaddyConfig
                                    (backend suppressed — the allowlist IS the body).
            '';
          };
          mtlsTrustPoolFile = mkOption {
            type = types.nullOr types.path;
            default = null;
            description = "PEM trust pool for client_auth. Required when gate uses mTLS.";
          };
        };
      };

      accessType = types.submodule {
        options = {
          scope = mkOption {
            type = types.enum [
              "public"
              "tailnet"
              "host-list"
              "funnel"
              "none"
            ];
            default = "tailnet";
            description = ''
              Allowed source scope. Drives the firewall interface:
                "public"    -> public interface (allowedTCPPorts).
                "tailnet" / "host-list" -> tailscale0 interface.
                "funnel"    -> Tailscale Funnel ingress (tailscaled owns :443; Caddy listens
                               on listenPort e.g. 8443; NO firewall opening — praeconinus).
                "none"      -> no inbound opening generated.
            '';
          };
          fromHosts = mkOption {
            type = types.listOf (types.enum hostNames);
            default = [ ];
            description = ''
              When scope == "host-list", the peer hosts permitted to reach the service.
              DECLARED INTENT ONLY — the host firewall is inbound-only and this repo does not
              own the tailnet ACL. Captured for the future headscale DERP ACLs; not auto-applied.
            '';
          };
        };
      };

      dnsType = types.submodule {
        options = {
          enable = mkEnableOption "emit an A/AAAA (or CNAME) record into the authoritative zone on aedilis";
          kind = mkOption {
            type = types.enum [
              "tailnet"
              "cname"
              "public"
            ];
            default = "tailnet";
            description = ''
              "tailnet" -> A/AAAA from constants.hosts.<host>.tailscale.{v4,v6}.
              "cname"   -> a CNAME (requires dns.cnameTarget).
              "public"  -> public A/AAAA (requires dns.publicV4/publicV6).
            '';
          };
          cnameTarget = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "CNAME target FQDN. Required when kind == cname.";
          };
          publicV4 = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "Public IPv4 for kind == public.";
          };
          publicV6 = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "Public IPv6 for kind == public.";
          };
        };
      };

      oidcType = types.submodule {
        options = {
          enable = mkEnableOption "register a Kanidm OIDC client on augustus";
          clientId = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = "OAuth2 client id. Defaults to the catalog entry name.";
          };
          public = mkOption {
            type = types.bool;
            default = false;
            description = "Public (PKCE, no secret) vs basic (basicSecretFile from secretRef).";
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
          secretRef = mkOption {
            type = types.nullOr types.str;
            default = null;
            description = ''
              sops secret NAME providing basicSecretFile (basic clients). The generator
              references config.sops.secrets.<secretRef>.path. Ignored when public == true.
            '';
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
      };

      managedByType = types.submodule {
        options = {
          caddy = mkEnableOption "let the caddy generator own this entry's vhost";
          acme = mkEnableOption "let the acme generator own this entry's cert";
          firewall = mkEnableOption "let the firewall generator own this entry's openings";
          dns = mkEnableOption "let the dns generator own this entry's record";
          oidc = mkEnableOption "let the oidc generator own this entry's client";
        };
      };

      entryType = types.submodule (
        { name, config, ... }:
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
                kind = "reverseProxy";
              };
              description = "Upstream the vhost serves.";
            };
            tls = mkOption {
              type = tlsType;
              default = { };
              description = "TLS/ACME + Caddy gate.";
            };
            access = mkOption {
              type = accessType;
              default = { };
              description = "Source scope / firewall.";
            };
            dns = mkOption {
              type = dnsType;
              default = { };
              description = "Authoritative DNS record.";
            };
            oidc = mkOption {
              type = oidcType;
              default = { };
              description = "Kanidm OIDC client.";
            };

            extraCaddyConfig = mkOption {
              type = types.lines;
              default = "";
              description = ''
                Free-form Caddyfile directives appended to the vhost body (or, with
                backend.kind == "raw", the entire body). Escape hatch for bespoke cases.
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
            oidc.clientId = lib.mkDefault name;
            tls.certGroup = lib.mkDefault name;
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
