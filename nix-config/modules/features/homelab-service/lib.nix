# Pure vhost-body renderer, published as `config.constants.catalogLib`.
#
# Shared by both Caddy backends (nixos services.caddy + darwin Caddyfile) so the vhost body
# is byte-identical across platforms, and by the acme generator for cert paths. No module
# output — only pure string functions.
#
# See docs/service-consolidation/catalog-and-generators.md §3.1. Operator-approved deviation
# (§7.8 #22): the reverse_proxy upstream token is 127.0.0.1 (NOT localhost) everywhere.
#
# Block ordering within a vhost body: tls → tracing → backend → extraCaddyConfig. This
# matches the current sources where tls precedes tracing (loki-push: `tls { client_auth }`
# then `tracing` then `reverse_proxy`). Bespoke bodies (kanidm transport, technitium metrics
# allowlist) use backend.kind == "raw" / gate == "mtls+allowlist" and supply the full body
# via extraCaddyConfig, bypassing the auto backend block.
{ lib, ... }@topLevel:
{
  config.constants.catalogLib = rec {
    fqdn = e: "${e.subdomain}.${e.zone}";
    url = e: "https://${fqdn e}";

    # Tracing span, emitted only when the host enables Tempo (mirrors homelab-api /
    # homelab-ui / kanidm / loki behavior exactly).
    tracingBlock =
      hostCfg: name:
      lib.optionalString hostCfg.services.tempo.enable ''
        tracing {
          span ${name}
        }
      '';

    # The backend directive.
    backendBlock =
      e:
      if e.backend.kind == "reverseProxy" then
        "reverse_proxy 127.0.0.1:${toString e.backend.port}\n"
      else if e.backend.kind == "static" then
        ''
          root * ${e.backend.root}
          header /*.html Cache-Control "no-cache, must-revalidate"
          file_server
        ''
      else
        ""; # "none" / "raw" -> no auto backend directive

    # mTLS wrapper for gate == "mtls" / "mtls+allowlist". When certPem/certKey are null the
    # server cert is Caddy-managed (loki-push, cicero, mini) -> cert-less `tls { client_auth }`;
    # otherwise an explicit cert is named (technitium metrics).
    mtlsTlsLine =
      {
        certPem ? null,
        certKey ? null,
        trustPool,
      }:
      let
        certPrefix = lib.optionalString (certPem != null) "${certPem} ${certKey} ";
      in
      ''
        tls ${certPrefix}{
          client_auth {
            mode require_and_verify
            trust_pool file {
              pem_file ${trustPool}
            }
          }
        }
      '';

    # Explicit cert line for a manual-TLS vhost (tls.ca != null, non-mTLS), matching kanidm.
    plainTlsLine = { certPem, certKey }: "tls ${certPem} ${certKey}\n";

    # THE shared vhost body. `certDir` is the ACME cert directory when the vhost names an
    # explicit cert (manual TLS on nixos); null for Caddy-managed / darwin.
    renderVhostBody =
      {
        hostCfg,
        entry,
        name,
        certDir ? null,
      }:
      let
        e = entry;
      in
      # "raw": emit ONLY extraCaddyConfig (suppress tls/tracing/backend) — kanidm, praeconinus.
      if e.backend.kind == "raw" then
        e.extraCaddyConfig
      else
        let
          isMtls = e.tls.gate == "mtls" || e.tls.gate == "mtls+allowlist";
          tls =
            if isMtls then
              mtlsTlsLine {
                certPem = if certDir != null then "${certDir}/fullchain.pem" else null;
                certKey = if certDir != null then "${certDir}/key.pem" else null;
                trustPool = e.tls.mtlsTrustPoolFile;
              }
            else if certDir != null then
              plainTlsLine {
                certPem = "${certDir}/fullchain.pem";
                certKey = "${certDir}/key.pem";
              }
            else
              "";
          # gate == "mtls+allowlist" supplies the body via extraCaddyConfig (the allowlist IS
          # the backend), so suppress the auto backendBlock.
          backend = lib.optionalString (e.tls.gate != "mtls+allowlist") (backendBlock e);
        in
        lib.concatStrings [
          tls
          (lib.optionalString e.tracing.enable (tracingBlock hostCfg name))
          backend
          e.extraCaddyConfig
        ];
  };
}
