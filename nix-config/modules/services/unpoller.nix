{ config, ... }:
let
  c = config.constants;
  svc = c.services.unpoller;
  lokiSvc = c.services.loki;
in
{
  flake.modules.nixos.unpoller =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.unpoller = {
        enable = true;

        poller = {
          debug = false;
          quiet = true;
        };

        # Disable InfluxDB — we use Prometheus + Loki
        influxdb.disable = true;

        # Prometheus exporter — bind to localhost only
        prometheus = {
          disable = false;
          http_listen = "127.0.0.1:${toString svc.port}";
          report_errors = false;
        };

        # Loki output for events, alarms, anomalies, IDS
        loki = {
          url = "http://127.0.0.1:${toString lokiSvc.port}/loki/api/v1/push";
          interval = "2m";
          timeout = "10s";
        };

        # UniFi controller configuration
        unifi.defaults = {
          url = "https://10.76.100.1"; 
          user = "unpoller";
          pass = config.sops.secrets.unpoller_password.path;
          sites = "all";
          verify_ssl = false;
          save_sites = true;
          save_ids = true;
          save_events = true;
          save_alarms = true;
          save_anomalies = true;
          save_dpi = false;
        };
      };

      services.failure-notifs.attachServices = [ "unifi-poller" ];
    };
}
