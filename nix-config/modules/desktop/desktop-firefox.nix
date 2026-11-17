{ inputs, ... }:
{
  # NixOS — system-wide Firefox with the p11-kit SecurityDevice policy and the
  # web-eid native messaging host (extracted from the nixos host's programs.nix).
  flake.modules.nixos.desktop-firefox =
    { pkgs, ... }:
    {
      programs.firefox = {
        enable = true;
        policies = {
          SecurityDevices.Add = {
            "p11-kit-proxy" = "${pkgs.p11-kit}/lib/p11-kit-proxy.so";
          };
        };
        nativeMessagingHosts = {
          packages = [ pkgs.web-eid-app ];
        };
      };
    };

  # Home-Manager
  flake.modules.homeManager.desktop-firefox =
    { config, pkgs, ... }:
    {
      programs.firefox = {
        enable = true;
        configPath = "${config.xdg.configHome}/mozilla/firefox";
        policies = {
          SecurityDevices.Add = {
            "p11-kit-proxy" = "${pkgs.p11-kit}/lib/p11-kit-proxy.so";
          };
        };
        nativeMessagingHosts = [ pkgs.web-eid-app ];
      };
    };
}
