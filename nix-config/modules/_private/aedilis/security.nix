{ inputs, lib, config, pkgs, ... }:
{
  security.sudo.execWheelOnly = true;

  # Trust the internal root CA (for step-ca-issued certs on the Tailscale endpoints).
  security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];

  networking.firewall = {
    enable = true;

    # Public, internet-facing ports.
    #
    # aedilis is an AUTHORITATIVE nameserver (recursion is locked down to trusted
    # ACLs inside Technitium — see docs/aedilis-host-plan.md §7a/§7b), so plain 53
    # is served publicly for authoritative answers and future HA (secondaries).
    allowedTCPPorts = [
      53 # DNS (authoritative, TCP fallback + future zone transfers)
      80 # Let's Encrypt HTTP-01 challenge (public ACME)
      443 # DoH (Caddy TLS termination)
      853 # DNS-over-TLS
    ];
    allowedUDPPorts = [
      53 # DNS (authoritative)
      853 # DNS-over-QUIC
    ];

    # Tailscale-only ports (admin UI, metrics, SSH, TS metrics exporter).
    interfaces.tailscale0 = {
      allowedTCPPorts = [
        22 # SSH
        443 # admin UI vhost (mTLS) — shares Caddy with public DoH via SNI
        8443 # dns-metrics endpoint (mTLS); see service-registry dns-metrics.port
        5252 # Tailscale metrics exporter
      ];
    };
  };

  services.openssh.openFirewall = false;
}
