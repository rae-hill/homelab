{
  lib,
  config,
  pkgs,
  pkgs-unstable,
  ...
}:
{
  # done (gnome)
  programs.dconf.enable = true;

  # done
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

  # done
  programs.steam = {
    enable = true;
    gamescopeSession.enable = true;
    remotePlay.openFirewall = true;
  };

  # done
  programs.gamemode.enable = true;

  # done
  programs._1password.enable = true;

  # done
  programs._1password-gui = {
    enable = true;
    polkitPolicyOwners = [
      "jacob"
      "rae"
    ];
  };

  # done
  # No home-manager module :(
  programs.zoom-us = {
    enable = true;
    package = pkgs-unstable.zoom-us;
  };

  # done
  environment.etc = {
    "1password/custom_allowed_browsers" = {
      text = ''
        vivaldi-bin
      '';
      mode = "0755";
    };
  };

  # done
  programs.zsh.enable = true;

  # done
  services.udev.packages = with pkgs; [
    via # done
    qmk-udev-rules # done
  ];

  # done
  environment.systemPackages = with pkgs; [
    home-manager # won't include
    vim # done
    geekbench # won't include
    git # done
    git-credential-manager # won't include
    mangohud # won't include
    starship # won't include
    zsh # won't include
    via # done
    quickemu # done
    adwaita-icon-theme
    openssl # done
    cifs-utils # done
    restic # done
    step-cli # done
    podman-compose # done
  ];

  # done
  environment.etc."pkcs11/modules/opensc-pkcs11".text = ''
    module: ${pkgs.opensc}/lib/opensc-pkcs11.so
  '';
}
