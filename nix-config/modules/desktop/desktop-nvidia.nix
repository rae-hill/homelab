# NVIDIA graphics stack for desktop hosts (merged from the old
# programs/nvidia.nix and features/home/desktop/desktop-nvidia.nix).
{ inputs, config, ... }:
let
  c = config.constants;
in
{
  # NixOS
  flake.modules.nixos.desktop-nvidia =
    {
      config,
      lib,
      pkgs,
      ...
    }:
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

      environment.variables = {
        LIBVA_DRIVER_NAME = "nvidia";
        NVD_BACKEND = "direct";
      };

      environment.systemPackages = with pkgs; [
        nvidia-vaapi-driver
      ];
    };
}
