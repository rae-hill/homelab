{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  security.sudo.execWheelOnly = true;

  # Trust the internal root CA (for step-ca-issued certs on the Tailscale endpoints).
  security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];

  networking.firewall = {
    enable = true;

    # Public, internet-facing ports.
    #
    # aedilis is a personal RECURSIVE resolver (NOT authoritative). Recursion is
    # open to any client (rate-limited — see docs/aedilis-host-plan.md §7a), but
    # ONLY over the encrypted transports: DoH (443), DoT (853/tcp), DoQ (853/udp),
    # all terminated natively by Technitium with a managed LE cert.
    #
    # Plain, plaintext DNS on port 53 is deliberately NOT exposed publicly. We
    # cannot disable Technitium's plain-53 listener selectively (DoH/DoT/DoQ bind
    # to the same interface addresses, only on different ports — confirmed in the
    # vendored source, DnsServer.cs), so 53 is closed at the firewall instead and
    # kept reachable only over Tailscale for our own devices.
    allowedTCPPorts = [
      80 # Let's Encrypt HTTP-01 challenge (Caddy; Technitium does not use 80)
      443 # DoH (Technitium-native TLS)
      853 # DoT (Technitium-native TLS)
    ];
    allowedUDPPorts = [
      853 # DoQ (Technitium-native TLS)
    ];

    # Tailscale-only ports (plain DNS for our own devices, admin UI, metrics, SSH,
    # TS metrics exporter).
    interfaces.tailscale0 = {
      allowedTCPPorts = [
        22 # SSH
        53 # plain DNS over Tailscale (personal recursive resolver; TCP fallback)
        8443 # admin UI vhost (Caddy, OIDC-gated, no mTLS)
        9443 # dns-metrics endpoint (Caddy, mTLS); see service-registry dns-metrics.port
        5252 # Tailscale metrics exporter
      ];
      allowedUDPPorts = [
        53 # plain DNS over Tailscale (personal recursive resolver)
      ];
    };
  };

  services.openssh.openFirewall = false;

  # SSH host certificate renewal via step-ca (like cicero). Requires step-ca
  # reachability over Tailscale + the JWK provisioner private key on the box, so it
  # only succeeds AFTER aedilis joins the tailnet and the ACLs are updated. The
  # daily timer will retry until then; see docs/aedilis-deployment-runbook.md.
  services.ssh-cert-renewer = {
    enable = true;
    sshKeyName = "ssh_host_ed25519_key";
    serviceName = "aedilis.plato-splunk.media";
    passwordFile = config.sops.secrets.step_jwk_provisioner_password.path;
  };
}
