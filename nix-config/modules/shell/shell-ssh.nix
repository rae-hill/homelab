# SSH: daemon baseline (merged from the old services/openssh.nix) + client
# agent + server hardening.
{ inputs, config, ... }:
let
  c = config.constants;
in
{
  # NixOS #
  flake.modules.nixos.openssh =
    {
      config,
      lib,
      pkgs,
      ...
    }:
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

  flake.modules.nixos.shell-ssh-client =
    { inputs, ... }:
    {
      programs.ssh = {
        startAgent = true;
        enableAskPassword = true;
      };
    };

  flake.modules.nixos.shell-ssh-server =
    { inputs, ... }:
    {
      services.openssh = {
        openFirewall = false;
        settings = {
          PermitRootLogin = "no";
          X11Forwarding = false;
        };
      };
    };
}
