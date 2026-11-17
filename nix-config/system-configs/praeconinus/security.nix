{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  # execWheelOnly + the internal root CA + firewall.enable come from
  # system-security-base — wired in default.nix.

  networking.firewall = {
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
