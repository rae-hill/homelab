# Firewall generator (nixos only).
#
# Reads the whole catalog; filters to entries on THIS host with managedBy.firewall. Emits
# networking.firewall openings for listenPort (per access.scope's interface) plus any
# tls.cert.own.challenge.via == "direct" acmePort (per challenge.iface). scope "funnel"/"none"
# and clientCertOnly entries open no listen port. Baseline infra ports stay hand-listed in
# _private/<host>/security.nix. See docs/service-consolidation/catalog-and-generators.md §3.5.
{ config, ... }@topLevel:
let
  catLib = topLevel.config.constants.catalogLib;
in
{
  flake.modules.nixos.homelab-service-firewall =
    { config, lib, ... }:
    let
      mine = lib.filterAttrs (
        _: e: e.host == config.networking.hostName && e.managedBy.firewall
      ) config.homelab.catalog;

      entries = lib.attrValues mine;

      scopeOf = e: catLib.tagOf e.access.scope;
      ownsCert = e: catLib.tagOf e.tls.cert == "own";

      # Listen-port openings, grouped by the interface access.scope selects. clientCertOnly
      # entries serve no vhost, so they open no listen port.
      portsFor =
        pred:
        lib.unique (
          lib.concatMap (e: lib.optionals (!e.clientCertOnly && pred e) [ e.listenPort ]) entries
        );

      publicListen = portsFor (e: scopeOf e == "public");
      tailnetListen = portsFor (e: scopeOf e == "tailnet" || scopeOf e == "hostList");

      # direct-challenge acmePorts, grouped by the own-cert challenge.iface.
      acmePortsFor =
        pred:
        lib.unique (
          lib.concatMap (
            e:
            lib.optionals (ownsCert e && e.tls.cert.own.challenge.via == "direct" && pred e) [
              e.tls.cert.own.acmePort
            ]
          ) entries
        );
      publicAcme = acmePortsFor (e: e.tls.cert.own.challenge.iface == "public");
      tailnetAcme = acmePortsFor (e: e.tls.cert.own.challenge.iface == "tailscale0");
    in
    {
      networking.firewall.allowedTCPPorts = publicListen ++ publicAcme;
      networking.firewall.interfaces.tailscale0.allowedTCPPorts = tailnetListen ++ tailnetAcme;
    };
}
