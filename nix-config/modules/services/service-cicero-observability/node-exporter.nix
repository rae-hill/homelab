{ config, ... }:
{
  flake.modules.nixos.cicero-observability-node-exporter =
    { ... }:
    {
      services.prometheus.exporters.node = {
        enable = true;
        port = 9100;
        listenAddress = "127.0.0.1";
        enabledCollectors = [
          "systemd"
          "processes"
        ];
      };
    };
}
