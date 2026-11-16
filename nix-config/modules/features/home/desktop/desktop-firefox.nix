{ inputs, ... }:
{
  flake.modules.homeManager.desktop-firefox =
    { pkgs }:
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
}
