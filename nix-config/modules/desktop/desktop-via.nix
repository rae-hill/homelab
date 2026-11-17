{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.desktop-via = { pkgs, ... }: {
    hardware.keyboard.qmk.enable = true;

    services.udev.packages = with pkgs; [
      via
      qmk-udev-rules
    ];

    environment.systemPacakges = with pkgs; [
      via
    ];
  };

}
