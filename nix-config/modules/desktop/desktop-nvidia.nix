{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.desktop-nvidia = { pkgs, ... }: {
    environment.variables = {
      LIBVA_DRIVER_NAME = "nvidia";
      NVD_BACKEND = "direct";
    };

    environment.systemPackages = with pkgs; [
      nvidia-vaapi-driver
    ];
  };
}
