{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.system-boot-base = { pkgs, ... }: {
    boot.tmp.cleanOnBoot = true;
  };

  flake.modules.nixos.system-boot-grub = { pkgs, ... }: {
    boot.loader.grub.enable = true;
    boot.loader.grub.configurationLimit = 10;
  };

  flake.modules.nixos.system-boot-generic = { pkgs, ... }: {
    boot.loader.grub.enable = false;

    boot.loader.generic-extlinux-compatible.enable = true;
    boot.loader.generic-extlinux-compatible.configurationLimit = 10;
  };

  flake.modules.nixos.system-boot-systemd = { pkgs, ... }: {
    boot.loader.systemd-boot.enable = true;
    boot.loader.systemd-boot.configurationLimit = 10;

    boot.loader.efi.canTouchEfiVariables = true;

    boot.kernelPackages = pkgs.linuxPackages_latest;
  };
}
