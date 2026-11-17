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

  flake.modules.nixos.system-networking-dns-host =
    { lib, ... }:
    {
      imports = with inputs.self.modules.nixos; [
        system-networking
      ];

      networking.hosts = {
        "127.0.0.1" = [ "dns.plato-splunk.media" ];
      };

      services.resolved = {
        enable = true;
        settings.Resolve = {
          # Override (rather than append to) the fleet-wide upstreams from
          # system-networking: the DNS host resolves through its own local
          # Technitium instance. The remaining Resolve settings (FallbackDNS,
          # Domains, DNSSEC, DNSOverTLS) are inherited from system-networking —
          # do not re-set list-valued options here or they concatenate.
          DNS = lib.mkForce [ "127.0.0.1#dns.plato-splunk.media" ];
        };
      };
    };
}
