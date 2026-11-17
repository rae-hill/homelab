{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  # execWheelOnly + the internal root CA + firewall.enable come from
  # system-security-base — wired in default.nix. Host-specific firewall rules
  # and the cert renewer stay here.

  networking.firewall = {
    interfaces = {
      tailscale0 = {
        allowedTCPPorts = [
          22
          5252
          5432
          25565
        ];
      };
    };

    allowedTCPPorts = [
      80

      # radius
      1812
      1813

      # NOTE: 443 (the shared Caddy vhost listen port) is now emitted by the
      # homelab-service-firewall generator from the public-scope catalog entries
      # (scope.public, listenPort 443). Baseline keeps the non-443 / non-service
      # infra ports below.
    ];

    allowedUDPPorts = [
      1812
      1813
    ];
  };

  services.openssh.openFirewall = false;

  services.ssh-cert-renewer = {
    sshKeyName = "ssh_host_ed25519_key";
    enable = true;
    serviceName = "augustus.plato-splunk.media";
    passwordFile = config.sops.secrets.step_jwk_provisioner_password.path;
  };
}
