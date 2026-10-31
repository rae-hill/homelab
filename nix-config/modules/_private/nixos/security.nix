{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  security.sudo.execWheelOnly = true;

  security.rtkit.enable = true;

  security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];

  networking.firewall = {
    enable = true;

    allowedTCPPorts = [
      10300
      10200
      49545
      58042
      56503
    ];

    allowedUDPPorts = [
      5353
      49545
      58042
      56503
    ];

    interfaces = {
      tailscale0 = {
        allowedTCPPorts = [
          22
          5252
          # Caddy ACME HTTP-01: the internal step-ca (cicero) validates the
          # opencode vhost's managed cert over the tailnet (mirrors cicero's
          # tailscale0-only :80). Never opened on the LAN/public interfaces.
          80
          # NOTE: 443 (the opencode mTLS vhost) is emitted by the
          # homelab-service-firewall generator from the opencode catalog entry
          # (access.scope.tailnet) — deliberately tailscale0-only.
        ];
        allowedUDPPorts = [ 5252 ];
      };
    };
  };

  services.openssh = {
    openFirewall = false;
    settings = {
      PermitRootLogin = "no";
      X11Forwarding = false;
    };
  };

  programs.ssh = {
    startAgent = true;
    enableAskPassword = true;
  };

  services.ssh-cert-renewer = {
    sshKeyName = "ssh_host_ed25519_key";
    enable = true;
    serviceName = "nixos.plato-splunk.media";
    passwordFile = config.sops.secrets.step_jwk_provisioner_password.path;
  };
}
