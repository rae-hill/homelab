{ config, ... }:
let
  c = config.constants;
  svc = c.services.grafana;
  promSvc = c.services.prometheus;
  lokiSvc = c.services.loki;
  tempoSvc = c.services.tempo;
in
{
  flake.modules.nixos.grafana-service =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.grafana = {
        enable = true;

        settings = {
          server = {
            http_addr = "127.0.0.1";
            http_port = svc.port;
            domain = svc.domain;
            root_url = svc.url;
          };

          "auth.generic_oauth" = {
            enabled = true;
            name = "Kanidm";
            client_id = svc.clientId;
            client_secret = "$__file{${config.sops.templates."grafana-client-secret".path}}";
            scopes = "openid email profile";
            auth_url = "https://${c.idm.domain}/ui/oauth2";
            token_url = "https://${c.idm.domain}/oauth2/token";
            api_url = "https://${c.idm.domain}/oauth2/openid/${svc.clientId}/userinfo";
            login_attribute_path = "preferred_username";
            role_attribute_path = "contains(roles[*], 'admin') && 'Admin' || 'Editor'";
            allow_sign_up = true;
            auto_login = true;
            use_pkce = true;
            tls_client_ca = c.ca.rootCert;
          };

          auth = {
            disable_login_form = true;
          };

          security = {
            secret_key = "$__file{${config.sops.secrets.grafana_secret.path}}";
          };

          analytics = {
            reporting_enabled = false;
            check_for_updates = false;
            check_for_plugin_updates = false;
          };

          unified_alerting = {
            enabled = true;
          };
        };

        provision = {
          enable = true;

          datasources.settings.datasources = [
            {
              name = "Prometheus";
              type = "prometheus";
              uid = "prometheus";
              url = "http://127.0.0.1:${toString promSvc.port}";
              isDefault = true;
              access = "proxy";
              orgId = 1;
            }
            {
              name = "Loki";
              type = "loki";
              uid = "loki";
              url = "http://127.0.0.1:${toString lokiSvc.port}";
              access = "proxy";
              orgId = 1;
            }
            {
              name = "Tempo";
              type = "tempo";
              uid = "tempo";
              url = "http://127.0.0.1:${toString tempoSvc.port}";
              access = "proxy";
              orgId = 1;
              jsonData = {
                tracesToLogsV2 = {
                  datasourceUid = "loki";
                  filterByTraceID = true;
                  filterBySpanID = false;
                  customQuery = false;
                };
                tracesToMetrics = {
                  datasourceUid = "prometheus";
                };
                serviceMap = {
                  datasourceUid = "prometheus";
                };
                nodeGraph = {
                  enabled = true;
                };
                search = {
                  hide = false;
                };
                traceQuery = {
                  timeShiftEnabled = true;
                  spanStartTimeShift = "-1h";
                  spanEndTimeShift = "1h";
                };
              };
            }
          ];

          alerting.contactPoints.settings.contactPoints = [
            {
              orgId = 1;
              name = "Pushover";
              receivers = [
                {
                  uid = "pushover-direct";
                  type = "pushover";
                  settings = {
                    userKey = "$__file{${config.sops.secrets.grafana_pushover_user_key.path}}";
                    apiToken = "$__file{${config.sops.secrets.grafana_pushover_token.path}}";
                    priority = "0";
                    retry = "30";
                    expire = "3600";
                  };
                }
              ];
            }
          ];

          alerting.rules.settings.groups = [
            {
              orgId = 1;
              name = "System Alerts";
              folder = "Infrastructure";
              interval = "1m";
              rules = [
                {
                  uid = "high-cpu-usage";
                  title = "High CPU Usage";
                  condition = "C";
                  data = [
                    {
                      refId = "A";
                      datasourceUid = "prometheus";
                      model = {
                        expr = ''100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)'';
                        intervalMs = 15000;
                        maxDataPoints = 43200;
                      };
                      relativeTimeRange = {
                        from = 300;
                        to = 0;
                      };
                    }
                    {
                      refId = "B";
                      datasourceUid = "__expr__";
                      model = {
                        type = "reduce";
                        expression = "A";
                        reducer = "last";
                      };
                      relativeTimeRange = {
                        from = 0;
                        to = 0;
                      };
                    }
                    {
                      refId = "C";
                      datasourceUid = "__expr__";
                      model = {
                        type = "threshold";
                        expression = "B";
                        conditions = [
                          {
                            evaluator = {
                              type = "gt";
                              params = [ 85 ];
                            };
                          }
                        ];
                      };
                      relativeTimeRange = {
                        from = 0;
                        to = 0;
                      };
                    }
                  ];
                  "for" = "5m";
                  labels = {
                    severity = "warning";
                  };
                  annotations = {
                    summary = "CPU usage has exceeded 85% for 5 minutes";
                  };
                }
                {
                  uid = "high-memory-usage";
                  title = "High Memory Usage";
                  condition = "C";
                  data = [
                    {
                      refId = "A";
                      datasourceUid = "prometheus";
                      model = {
                        expr = "(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100";
                        intervalMs = 15000;
                        maxDataPoints = 43200;
                      };
                      relativeTimeRange = {
                        from = 300;
                        to = 0;
                      };
                    }
                    {
                      refId = "B";
                      datasourceUid = "__expr__";
                      model = {
                        type = "reduce";
                        expression = "A";
                        reducer = "last";
                      };
                      relativeTimeRange = {
                        from = 0;
                        to = 0;
                      };
                    }
                    {
                      refId = "C";
                      datasourceUid = "__expr__";
                      model = {
                        type = "threshold";
                        expression = "B";
                        conditions = [
                          {
                            evaluator = {
                              type = "gt";
                              params = [ 90 ];
                            };
                          }
                        ];
                      };
                      relativeTimeRange = {
                        from = 0;
                        to = 0;
                      };
                    }
                  ];
                  "for" = "5m";
                  labels = {
                    severity = "warning";
                  };
                  annotations = {
                    summary = "Memory usage has exceeded 90% for 5 minutes";
                  };
                }
                {
                  uid = "disk-space-low";
                  title = "Disk Space Low";
                  condition = "C";
                  data = [
                    {
                      refId = "A";
                      datasourceUid = "prometheus";
                      model = {
                        expr = ''(1 - node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}) * 100'';
                        intervalMs = 15000;
                        maxDataPoints = 43200;
                      };
                      relativeTimeRange = {
                        from = 300;
                        to = 0;
                      };
                    }
                    {
                      refId = "B";
                      datasourceUid = "__expr__";
                      model = {
                        type = "reduce";
                        expression = "A";
                        reducer = "last";
                      };
                      relativeTimeRange = {
                        from = 0;
                        to = 0;
                      };
                    }
                    {
                      refId = "C";
                      datasourceUid = "__expr__";
                      model = {
                        type = "threshold";
                        expression = "B";
                        conditions = [
                          {
                            evaluator = {
                              type = "gt";
                              params = [ 85 ];
                            };
                          }
                        ];
                      };
                      relativeTimeRange = {
                        from = 0;
                        to = 0;
                      };
                    }
                  ];
                  "for" = "5m";
                  labels = {
                    severity = "critical";
                  };
                  annotations = {
                    summary = "Root filesystem usage has exceeded 85% for 5 minutes";
                  };
                }
                {
                  uid = "systemd-unit-failed";
                  title = "Systemd Unit Failed";
                  condition = "C";
                  data = [
                    {
                      refId = "A";
                      datasourceUid = "prometheus";
                      model = {
                        expr = ''node_systemd_unit_state{state="failed"} == 1'';
                        intervalMs = 15000;
                        maxDataPoints = 43200;
                      };
                      relativeTimeRange = {
                        from = 60;
                        to = 0;
                      };
                    }
                    {
                      refId = "B";
                      datasourceUid = "__expr__";
                      model = {
                        type = "reduce";
                        expression = "A";
                        reducer = "last";
                      };
                      relativeTimeRange = {
                        from = 0;
                        to = 0;
                      };
                    }
                    {
                      refId = "C";
                      datasourceUid = "__expr__";
                      model = {
                        type = "threshold";
                        expression = "B";
                        conditions = [
                          {
                            evaluator = {
                              type = "gt";
                              params = [ 0 ];
                            };
                          }
                        ];
                      };
                      relativeTimeRange = {
                        from = 0;
                        to = 0;
                      };
                    }
                  ];
                  "for" = "1m";
                  labels = {
                    severity = "critical";
                  };
                  annotations = {
                    summary = "A systemd unit has entered failed state";
                  };
                }
              ];
            }
          ];
        };
      };

      # Ensure Grafana starts after its datasource backends
      systemd.services.grafana = {
        after = [
          "prometheus.service"
          "loki.service"
          "tempo.service"
        ];
        requires = [
          "prometheus.service"
          "loki.service"
          "tempo.service"
        ];
      };

      # Caddy reverse proxy (OIDC handles auth) — now generated from the catalog
      # (features/grafana/catalog.nix). Vhost removed here.

      services.failure-notifs.attachServices = [
        "grafana"
      ];
    };
}
