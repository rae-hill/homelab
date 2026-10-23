# Firewall generator (nixos only).
#
# Reads the whole catalog; filters to entries on THIS host with managedBy.firewall. Emits
# networking.firewall openings for listenPort (per access.scope's interface) plus any
# tls.challenge.via == "direct" acmePort (per tls.challenge.iface). scope "funnel"/"none" and
# clientCertOnly entries open no listen port. Baseline infra ports stay hand-listed in
# _private/<host>/security.nix. See docs/service-consolidation/catalog-and-generators.md §3.5.
{ ... }:
{
  flake.modules.nixos.homelab-service-firewall =
    { config, lib, ... }:
    let
      mine = lib.filterAttrs (
        _: e: e.host == config.networking.hostName && e.managedBy.firewall
      ) config.homelab.catalog;

      entries = lib.attrValues mine;

      # Listen-port openings, grouped by the interface access.scope selects. clientCertOnly
      # entries serve no vhost, so they open no listen port.
      portsFor =
        pred:
        lib.unique (
          lib.concatMap (e: lib.optionals (!e.clientCertOnly && pred e) [ e.listenPort ]) entries
        );

      publicListen = portsFor (e: e.access.scope == "public");
      tailnetListen = portsFor (e: e.access.scope == "tailnet" || e.access.scope == "host-list");

      # direct-challenge acmePorts, grouped by tls.challenge.iface.
      acmePortsFor =
        pred:
        lib.unique (
          lib.concatMap (
            e: lib.optionals (e.tls.ca != null && e.tls.challenge.via == "direct" && pred e) [ e.tls.acmePort ]
          ) entries
        );
      publicAcme = acmePortsFor (e: e.tls.challenge.iface == "public");
      tailnetAcme = acmePortsFor (e: e.tls.challenge.iface == "tailscale0");
    in
    {
      networking.firewall.allowedTCPPorts = publicListen ++ publicAcme;
      networking.firewall.interfaces.tailscale0.allowedTCPPorts = tailnetListen ++ tailnetAcme;
    };
}
