{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  # Networking/DNS (system-networking), locale (system-locale), allowUnfree
  # (system-nix-base), ssh client/server hardening (shell-ssh-*), and the
  # security baseline (system-security-*) come from modules/ — wired in
  # default.nix. Only nixos-specific settings live here.

  # NOTE: deliberately NOT system-boot-systemd: that module also sets
  # boot.kernelPackages = linuxPackages_latest, while this host stays on the
  # stable kernel. Kept inline until the kernel choice is decided.
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;
  # Bound the number of boot entries kept on the 511 MB ESP (/boot). Without this,
  # systemd-boot copies every generation's kernel + initrd to the ESP, and with the
  # daily autoUpgrade below that fills the small FAT32 partition and breaks the
  # bootloader install step ("No space left on device"). 10 generations is plenty
  # for rollback while leaving ample ESP headroom.
  boot.loader.systemd-boot.configurationLimit = 10;

  boot.binfmt.emulatedSystems = [ "aarch64-linux" ];

  system.autoUpgrade = {
    enable = true;
    dates = "04:00";
    flake = inputs.self.outPath;
    flags = [
      "--update-input"
      "nixpkgs"
    ];
    allowReboot = false;
  };

  hardware.keyboard.qmk.enable = true; # done

  # done
  fonts = {
    packages = with pkgs; [
      victor-mono
      noto-fonts
      noto-fonts-color-emoji
    ];

    fontconfig = {
      useEmbeddedBitmaps = true;
      defaultFonts = {
        serif = [ "noto-serif" ];
        sansSerif = [ "noto-sans-meetei-mayek" ];
        monospace = [ "victor-mono" ];
      };
    };
  };

  nixpkgs = {
    overlays = [
      (self: super: {
        ctranslate2 = super.ctranslate2.override {
          withCUDA = true;
          withCuDNN = true;
        };
      })
    ];

    config = {
      allowUnfreePredicate =
        pkg:
        builtins.elem (lib.getName pkg) [
          "1password-gui"
          "1password"
        ];
    };
  };

  system.stateVersion = "24.05";
}
