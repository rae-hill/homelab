{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
let
  rootCert = ../../../../certs/alford-root.crt;
in
{
  programs.zsh = {
    enable = true;
    enableCompletion = true;
    enableSyntaxHighlighting = true;
  };

  environment.systemPackages = [
    pkgs.step-cli
  ];

  environment.etc."caddy_nix/Caddyfile".text = ''
    {
      email web@jacob-alford.dev
      acme_ca https://ca.plato-splunk.media/acme/http/directory
      acme_ca_root /etc/step/certs/root_ca.crt

      storage file_system /etc/caddy
      
      admin off
      metrics
    }

    https://mini-caddy-metrics.plato-splunk.media {
      tls {
        client_auth {
          mode require_and_verify
          trust_pool file {
            pem_file ${rootCert}
          }
        }
      }

      reverse_proxy localhost:2019
    }

    https://jellyfin.plato-splunk.media {
      handle_path /metrics {
        tls {
          client_auth {
            mode require_and_verify
            trust_pool file {
              pem_file ${rootCert}
            }
          }
        }
      }

      reverse_proxy localhost:8096
    }
  '';

  launchd.daemons.caddy = {
    command = "${pkgs.caddy}/bin/caddy run --config /etc/caddy_nix/Caddyfile --adapter caddyfile";
    serviceConfig = {
      KeepAlive = true;
      RunAtLoad = true;
      StandardOutPath = "/etc/caddy/logs/caddy.info.log";
      StandardErrorPath = "/etc/caddy/logs/caddy.err.log";
    };
  };

  system.configurationRevision = inputs.self.rev or inputs.self.dirtyRev or null;

  system.primaryUser = "jacob";

  system.stateVersion = 6;

  nixpkgs.hostPlatform = "aarch64-darwin";

  nixpkgs.config.allowUnfree = true;
  nixpkgs.config.allowUnfreePredicate =
    pkg:
    builtins.elem (lib.getName pkg) [
    ];
}
