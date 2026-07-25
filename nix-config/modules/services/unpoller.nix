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
      pkgs-unstable,
      ...
    }:
    let
      cfg = {
        poller = {
          debug = false;
        };

        influxdb.disable = true;

        prometheus = {
          disable = false;
          http_listen = "127.0.0.1:${toString svc.port}";
          report_errors = false;
        };

        # Loki output for events, arms, anomalies, IDS
        loki = {
          url = "http://127.0.0.1:${toString lokiSvc.port}/loki/api/v1/push";
          interval = "2m";
          timeout = "10s";
        };

        unifi.defaults = {
          url = "https://10.76.100.1";
          user = "unpoller";
          pass = config.sops.secrets.unpoller_password.path;
          sites = [ "all" ];
          verify_ssl = false;
          save_sites = true;
          save_syslog = true;
          save_events = false;
          save_protect_logs = true;
          save_ids = false;
          save_alarms = false;
        };
      };

      configFile = pkgs.writeText "patched_unpoller.json" (lib.generators.toJSON { } cfg);
    in
    {
      systemd.services.unifi-poller = {
        serviceConfig = {
          ExecStart = lib.mkForce "${pkgs-unstable.unpoller}/bin/unpoller --config ${configFile}";
        };
      };

      services.unpoller.enable = true;
      services.failure-notifs.attachServices = [ "unifi-poller" ];
    };
}
