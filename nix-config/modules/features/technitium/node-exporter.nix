{ config, ... }:
let
  c = config.constants;
  dnsMetrics = c.services.dns-metrics;
in
{
  flake.modules.nixos.technitium-node-exporter =
    { ... }:
    {
      services.prometheus.exporters.node = {
        enable = true;
        port = dnsMetrics.nodeExporterPort;
        listenAddress = "127.0.0.1";
        enabledCollectors = [
          "systemd"
          "processes"
        ];
      };
    };
}
