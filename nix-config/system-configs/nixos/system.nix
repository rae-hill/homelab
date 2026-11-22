{ inputs, ... }:
{
  flake.modules.nixos.host-nixos-system =
    {
      inputs,
      lib,
      config,
      pkgs,
      ...
    }:
    {
      # Boot (system-boot-systemd — linuxPackages_latest is fine, tied to
      # nixos-26.05), binfmt+quickemu (system-emulation), fonts (system-fonts),
      # qmk/via (desktop-via), networking/DNS (system-networking), locale
      # (system-locale), allowUnfree (system-nix-base), ssh hardening
      # (shell-ssh-*) and the security baseline (system-security-*) all come from
      # modules/ — wired in default.nix. Only nixos-specific settings live here.

      # Bound the number of boot entries kept on the 511 MB ESP (/boot). Without this,
      # systemd-boot copies every generation's kernel + initrd to the ESP, and with the
      # daily autoUpgrade below that fills the small FAT32 partition and breaks the
      # bootloader install step ("No space left on device").
      # NOTE: configurationLimit = 10 itself comes from system-boot-systemd.
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

      networking.hosts = {
        "127.0.0.1" = [
          "opencode.plato-splunk.media"
        ];
        "::1" = [
          "opencode.plato-splunk.media"
        ];
      };

      # Host-specific user tweaks on top of users-human (imported in default.nix).
      users.users.jacob = {
        # Start user@1000 at boot (no graphical login needed) so the opencode-web
        # home-manager user service is reachable from other devices after a reboot.
        linger = true;
        extraGroups = [ "podman" ];
      };
      users.users.rae.extraGroups = [ "podman" ];

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
    };
}
