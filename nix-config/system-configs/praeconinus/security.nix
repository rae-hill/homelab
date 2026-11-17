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
          443
          5252
        ];
        allowedUDPPorts = [ 5252 ];
      };
    };

    allowedTCPPorts = [ 443 ];
  };

  services.openssh.openFirewall = false;
}
