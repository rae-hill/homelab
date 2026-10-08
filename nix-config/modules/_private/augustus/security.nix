{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  security.sudo.execWheelOnly = true;

  security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];

  networking.firewall = {
    enable = true;

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
      443

      # radius
      1812
      1813
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
