{ config, ... }:
let
  c = config.constants;
  svc = c.services.tempo;
in
{
  flake.modules.nixos.tempo =
    { config, lib, pkgs, ... }:
    {
      services.tempo = {
        enable = true;
        settings = {
          server = {
            http_listen_port = svc.port;
            http_listen_address = "127.0.0.1";
            grpc_listen_port = 9095;
            grpc_listen_address = "127.0.0.1";
          };

          distributor = {
            receivers = {
              otlp = {
                protocols = {
                  grpc = {
                    endpoint = "127.0.0.1:${toString svc.grpcPort}";
                    # Kanidm startup can produce large spans
                    max_recv_msg_size_mib = 20;
                  };
                };
              };
            };
          };

          storage = {
            trace = {
              backend = "local";
              local = {
                path = "${svc.stateDir}/traces";
              };
              wal = {
                path = "${svc.stateDir}/wal";
              };
            };
          };

          compactor = {
            compaction = {
              block_retention = "2160h"; # 90 days
            };
          };

          metrics_generator = {
            ring = {
              instance_addr = "127.0.0.1";
              kvstore = {
                store = "inmemory";
              };
            };
            processor = {
              span_metrics = { };
              service_graphs = { };
              local_blocks = {
                flush_to_storage = true;
                max_block_duration = "5m";
              };
            };
            traces_storage = {
              path = "${svc.stateDir}/generator/traces";
            };
            storage = {
              path = "${svc.stateDir}/generator/wal";
              remote_write_flush_deadline = "1m";
              remote_write = [
                {
                  url = "http://127.0.0.1:${toString c.services.prometheus.port}/api/v1/write";
                  send_exemplars = true;
                }
              ];
            };
          };

          overrides = {
            defaults = {
              metrics_generator = {
                processors = [ "span-metrics" "service-graphs" "local-blocks" ];
              };
            };
          };
        };
      };

      services.failure-notifs.attachServices = [ "tempo" ];
    };
}
