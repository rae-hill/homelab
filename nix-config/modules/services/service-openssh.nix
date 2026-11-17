{ config, ... }:
let
  c = config.constants;
in
{
  flake.modules.nixos.openssh =
    { config, lib, pkgs, ... }:
    {
      services.openssh = {
        enable = true;
        settings = {
          PasswordAuthentication = lib.mkDefault false;
          KbdInteractiveAuthentication = lib.mkDefault false;
          AllowUsers = lib.mkDefault [ "jacob" ];
          TrustedUserCAKeys = lib.mkDefault c.ca.sshUserCaCert;
        };
        hostKeys = lib.mkDefault [
          {
            type = "ed25519";
            path = "/etc/ssh/ssh_host_ed25519_key";
          }
        ];
        extraConfig = lib.mkDefault ''
          HostCertificate /etc/ssh/ssh_host_ed25519_key-cert.pub
        '';
      };
    };
}
