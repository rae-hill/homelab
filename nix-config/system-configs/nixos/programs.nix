{ inputs, ... }:
{
  flake.modules.nixos.host-nixos-programs =
    {
      lib,
      config,
      pkgs,
      pkgs-unstable,
      ...
    }:
    {
      # Everything else moved to shared modules — wired in default.nix:
      #   dconf/gnome            -> desktop-gnome
      #   firefox (system)       -> desktop-firefox
      #   steam + gamemode       -> games-steam
      #   1password (+gui, etc)  -> desktop-1password-gui (via desktop-complete + direct)
      #   zoom                   -> desktop-zoom (via desktop-complete)
      #   zsh                    -> shell-zsh (via desktop-complete)
      #   via/qmk udev + package -> desktop-via
      #   vim/git/openssl/cifs-utils/restic/step-cli -> system-programs
      #   podman-compose         -> system-podman
      #   quickemu               -> system-emulation
      # Dropped on purpose (marked "won't include" — provided via home-manager or
      # retired): home-manager, geekbench, git-credential-manager, mangohud,
      # starship, zsh (package).

      # Tell p11-kit to load/proxy opensc-pkcs11.so, providing all available slots
      # (PIN1 for authentication/decryption, PIN2 for signing).
      environment.etc."pkcs11/modules/opensc-pkcs11".text = ''
        module: ${pkgs.opensc}/lib/opensc-pkcs11.so
      '';

      environment.systemPackages = with pkgs; [
        adwaita-icon-theme
        # Wrapper script to tell to Chrome/Chromium to use p11-kit-proxy to load
        # security devices, so they can be used for TLS client auth.
        # Each user needs to run this themselves, it does not work on a system level
        # due to a bug in Chromium:
        #
        # https://bugs.chromium.org/p/chromium/issues/detail?id=16387
        (pkgs.writeShellScriptBin "setup-browser-eid" ''
          NSSDB="''${HOME}/.pki/nssdb"
          mkdir -p ''${NSSDB}

          ${pkgs.nssTools}/bin/modutil -force -dbdir sql:$NSSDB -add p11-kit-proxy \
            -libfile ${pkgs.p11-kit}/lib/p11-kit-proxy.so
        '')
      ];
    };
}
