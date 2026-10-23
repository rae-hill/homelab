# DNS record generator (nixos, aedilis only via the import matrix).
#
# Reads the WHOLE catalog (every host — central DNS); filters to managedBy.dns AND dns.enable.
# NO host == filter. Groups by zone, folds each group into
# services.technitium-server-complete.provision.ensureDnsRecords.zones, deriving A/AAAA from
# constants.hosts.<host>.tailscale. Merges non-service static extras (nas + public endpoints,
# host apexes) from constants.dnsExtraRecords. The record attrTag shape matches
# technitium-provisioning/options.nix. Upsert-only semantics unchanged.
#
# See docs/service-consolidation/catalog-and-generators.md §3.6 and dns-records.md.
{ config, ... }@topLevel:
let
  c = topLevel.config.constants;
  catLib = c.catalogLib;
in
{
  flake.modules.nixos.homelab-service-dns =
    { config, lib, ... }:
    let
      inherit (lib)
        filterAttrs
        attrValues
        groupBy
        concatMap
        mapAttrs
        ;

      wanted = attrValues (filterAttrs (_: e: e.managedBy.dns && e.dns.enable) config.homelab.catalog);

      mkRecordsFor =
        e:
        let
          apex = catLib.fqdn e;
        in
        if e.dns.kind == "cname" then
          [
            {
              CNAME = {
                name = apex;
                cname = e.dns.cnameTarget;
              };
            }
          ]
        else if e.dns.kind == "public" then
          [
            {
              A = {
                name = apex;
                address = e.dns.publicV4;
              };
            }
            {
              AAAA = {
                name = apex;
                address = e.dns.publicV6;
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
