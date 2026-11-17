{ config, ... }:
let
  c = config.constants;
in
{
  flake.modules.nixos.nvidia =
    { config, lib, pkgs, ... }:
    {
      services.xserver.videoDrivers = [ "nvidia" ];

      hardware.graphics = {
        enable = true;
        enable32Bit = true;
      };

      hardware.nvidia = {
        modesetting.enable = true;
        powerManagement.enable = true;
        powerManagement.finegrained = false;
        open = true;

        nvidiaSettings = false;

        package = config.boot.kernelPackages.nvidiaPackages.mkDriver {
          version = c.nvidia.version;
          sha256_64bit = c.nvidia.sha256_64bit;
          openSha256 = c.nvidia.openSha256;
          settingsSha256 = "";
          persistencedSha256 = "";
        };
      };
    };
}
