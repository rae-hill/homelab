# DNS record generator (nixos, aedilis only via the import matrix).
#
# DNS is CENTRAL: aedilis must emit records for services on EVERY host. But catalog entries
# (`homelab.catalog.<name>`) are contributed via per-host NixOS module imports, so aedilis's
# `config.homelab.catalog` only contains aedilis-local entries — it cannot see augustus/cicero/
# mini services. The caddy/acme/firewall/oidc generators are fine with that (they only act on
# local entries), but DNS is the one GLOBAL concern.
#
# So the DNS fold reads a FLAKE-LEVEL aggregate, `constants.catalogDns` — a global attrset each
# service's catalog.nix contributes to at the flake-parts level (alongside its per-host
# `homelab.catalog.<name>` entry). `constants` is a flake-parts option merged across all modules
# regardless of host, so this aggregate sees every service on every host. Each value is
# `{ subdomain; zone; host; record = <attrTag: tailnet|cname|public>; }`.
#
# Groups by zone, derives A/AAAA from constants.hosts.<host>.tailscale, and merges the
# non-service static extras (nas + public endpoints + host apexes) from constants.dnsExtraRecords.
# The record attrTag shape matches technitium-provisioning/options.nix. Upsert-only semantics.
#
# See docs/service-consolidation/catalog-and-generators.md §3.6 and dns-records.md.
{ config, ... }@topLevel:
let
  c = topLevel.config.constants;
  catalogDns = topLevel.config.flake.catalogDns or { };
in
{
  flake.modules.nixos.homelab-service-dns =
    { config, lib, ... }:
    let
      inherit (lib)
        attrValues
        groupBy
        concatMap
        mapAttrs
        ;

      tagOf = v: lib.head (lib.attrNames v);

      wanted = attrValues catalogDns;

      mkRecordsFor =
        e:
        let
          apex = "${e.subdomain}.${e.zone}";
          kind = tagOf e.record;
        in
        if kind == "cname" then
          [
            {
              CNAME = {
                name = apex;
                cname = e.record.cname.target;
              };
            }
          ]
        else if kind == "public" then
          [
            {
              A = {
                name = apex;
                address = e.record.public.v4;
              };
            }
            {
              AAAA = {
                name = apex;
                address = e.record.public.v6;
              };
            }
          ]
        else
          let
            ts = c.hosts.${e.host}.tailscale;
          in
          [
            {
              A = {
                name = apex;
                address = ts.v4;
              };
            }
            {
              AAAA = {
                name = apex;
                address = ts.v6;
              };
            }
          ];

      byZone = groupBy (e: e.zone) wanted;

      generatedRecordsByZone = mapAttrs (_zone: svcs: concatMap mkRecordsFor svcs) byZone;

      # Non-service outliers (nas LAN record + public endpoint identities + host apexes),
      # keyed by zone. Declared in constants (replaces nasRecords/publicEndpointRecords).
      extrasByZone = c.dnsExtraRecords or { };

      allZoneNames = lib.unique (lib.attrNames generatedRecordsByZone ++ lib.attrNames extrasByZone);

      zones = lib.listToAttrs (
        map (zone: {
          name = zone;
          value = {
            type = "Primary";
            records = (generatedRecordsByZone.${zone} or [ ]) ++ (extrasByZone.${zone} or [ ]);
          };
        }) allZoneNames
      );
    in
    {
      services.technitium-server-complete.provision.ensureDnsRecords.zones = zones;
    };
}
