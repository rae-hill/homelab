{ inputs, ... }:
{
  flake.modules.nixos.system-networking = {
    networking.networkmanager.enable = true;

    services.tailscale = {
      enable = true;
      extraSetFlags = [ "--webclient" ];
    };

    systemd.services.tailscaled.environment = {
      TS_PERMIT_CERT_UID = "caddy";
    };

    services.resolved = {
      enable = true;
      settings.Resolve = {
        DNS = [
          "15.204.95.40#dns.plato-splunk.media"
          "2604:2dc0:222::64d#dns.plato-splunk.media"
        ];
        FallbackDNS = [ ];
        Domains = [ "~." ];
        DNSSEC = "true";
        DNSOverTLS = "yes";
      };
    };
  };

  flake.modules.nixos.system-networking-dns-host = {
    imports = with inputs.self.modules.nixos; [
      system-networking
    ];

    networking.hosts = {
      "127.0.0.1" = [ "dns.plato-splunk.media" ];
    };

    services.resolved = {
      enable = true;
      settings.Resolve = {
        DNS = [
          "127.0.0.1#dns.plato-splunk.media"
        ];
        FallbackDNS = [ ];
        Domains = [ "~." ];
        DNSSEC = "true";
        DNSOverTLS = "yes";
      };
    };
  };
}
