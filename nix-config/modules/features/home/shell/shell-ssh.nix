{ inputs, ... }:
{
  # NixOS #
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
