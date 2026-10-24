# Pure vhost-body renderer, published as `config.constants.catalogLib`.
#
# Shared by both Caddy backends (nixos services.caddy + darwin Caddyfile) so the vhost body
# is byte-identical across platforms, and by the acme generator for cert paths. No module
# output — only pure string functions and a couple of attrTag helpers.
#
# See docs/service-consolidation/catalog-and-generators.md §3.1. Operator-approved deviation
# (§7.8 #22): the reverse_proxy upstream token is 127.0.0.1 (NOT localhost) everywhere.
#
# attrTag helpers: the schema (options.nix) models every discriminated union as a
# `types.attrTag`, i.e. a one-key attrset `{ <tag> = { …payload… }; }`. `tagOf` returns the
# tag name and `payloadOf` the payload; generators switch on `tagOf`.
#
# Block ordering within a vhost body: tls → tracing → backend → extraCaddyConfig. This
# matches the current sources where tls precedes tracing (loki-push: `tls { client_auth }`
# then `tracing` then `reverse_proxy`). Bespoke bodies (kanidm transport, technitium metrics
# allowlist) use backend == { raw = { }; } / gate == { mtlsAllowlist = …; } and supply the
# full body via extraCaddyConfig, bypassing the auto backend block.
{ lib, ... }@topLevel:
{
  config.constants.catalogLib = rec {
    # ---- attrTag helpers ----------------------------------------------------------------
    # The single tag name of an attrTag value (e.g. "reverseProxy", "own", "mtls").
    tagOf = v: lib.head (lib.attrNames v);
    # The payload submodule behind the tag.
    payloadOf = v: v.${tagOf v};

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

    # The backend directive, switching on the backend attrTag.
    backendBlock =
      e:
      let
        b = e.backend;
        kind = tagOf b;
      in
      if kind == "reverseProxy" then
        "reverse_proxy 127.0.0.1:${toString b.reverseProxy.port}\n"
      else if kind == "static" then
        ''
          root * ${b.static.root}
          header /*.html Cache-Control "no-cache, must-revalidate"
          file_server
        ''
      else
        ""; # "none" / "raw" -> no auto backend directive

    # mTLS wrapper for gate == { mtls = …; } / { mtlsAllowlist = …; }. When certPem/certKey
    # are null the server cert is Caddy-managed (loki-push, cicero, mini) -> cert-less
    # `tls { client_auth }`; otherwise an explicit cert is named (technitium metrics).
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

    # Explicit cert line for a manual-TLS vhost (tls.cert == { own = …; }, non-mTLS), kanidm.
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
      # backend == { raw = { }; }: emit ONLY extraCaddyConfig (suppress tls/tracing/backend) —
      # kanidm, praeconinus.
      if tagOf e.backend == "raw" then
        e.extraCaddyConfig
      else
        let
          gateTag = tagOf e.tls.gate;
          isMtls = gateTag == "mtls" || gateTag == "mtlsAllowlist";
          tls =
            if isMtls then
              mtlsTlsLine {
                certPem = if certDir != null then "${certDir}/fullchain.pem" else null;
                certKey = if certDir != null then "${certDir}/key.pem" else null;
                trustPool = (payloadOf e.tls.gate).trustPoolFile;
              }
            else if certDir != null then
              plainTlsLine {
                certPem = "${certDir}/fullchain.pem";
                certKey = "${certDir}/key.pem";
              }
            else
              "";
          # gate == { mtlsAllowlist = …; } supplies the body via extraCaddyConfig (the
          # allowlist IS the backend), so suppress the auto backendBlock.
          backend = lib.optionalString (gateTag != "mtlsAllowlist") (backendBlock e);
        in
        lib.concatStrings [
          tls
          (lib.optionalString e.tracing.enable (tracingBlock hostCfg name))
          backend
          e.extraCaddyConfig
        ];
  };
}
