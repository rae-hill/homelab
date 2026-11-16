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
          "45.90.28.0#praeconinus-cbc883.dns.nextdns.io"
          "2a07:a8c0::#praeconinus-cbc883.dns.nextdns.io"
          "45.90.30.0#praeconinus-cbc883.dns.nextdns.io"
          "2a07:a8c1::#praeconinus-cbc883.dns.nextdns.io"
        ];
        FallbackDNS = [
          "45.90.28.103"
          "45.90.30.103"
        ];
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
        FallbackDNS = [
          "45.90.28.103"
          "45.90.30.103"
        ];
        Domains = [ "~." ];
        DNSSEC = "true";
        DNSOverTLS = "yes";
      };
    };
  };
}
