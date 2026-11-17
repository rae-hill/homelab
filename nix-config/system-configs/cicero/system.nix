{ inputs, ... }:
{
  flake.modules.nixos.host-cicero-system =
    {
      lib,
      config,
      pkgs,
      ...
    }:
    {
      # Boot (system-boot-systemd), networking/DNS (system-networking), locale
      # (system-locale), and allowUnfree (system-nix-base) come from modules/system
      # — wired in default.nix. Only cicero-specific settings live here.

      hardware.bluetooth = {
        enable = false;
      };

      networking.hosts = {
        "127.0.0.1" = [
          "ca.plato-splunk.media"
          "cicero-metrics.plato-splunk.media"
          "ca-monitoring.plato-splunk.media"
        ];
      };

      environment.sessionVariables = {
        CA_URL = "https://ca.plato-splunk.media";
        CA_FINGERPRINT = "56c220018d0c65d5283d46d7c769eb471c18b2e903b205a9457261b2c52f2392";
      };

      services.getty.autologinUser = "jacob";

      services.xserver.xkb = {
        layout = "us";
        variant = "";
      };

      system.stateVersion = "25.11";
    };
}
