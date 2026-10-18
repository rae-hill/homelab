{
  lib,
  config,
  pkgs,
  ...
}:
{
  # OVHCloud base-image settings (preserved from the provisioned configuration.nix)
  # Workaround for https://github.com/NixOS/nix/issues/8502
  services.logrotate.checkConfig = false;

  boot.tmp.cleanOnBoot = true;
  zramSwap.enable = true;

  # BIOS/GRUB boot on the OVH VPS (no EFI).
  boot.loader.grub.enable = true;
  # Bound the GRUB generation menu. GRUB keeps kernels on the root fs (not a tiny
  # ESP), so this is lower-risk than the systemd-boot hosts, but bounding the menu
  # keeps /boot tidy and consistent with the rest of the fleet.
  boot.loader.grub.configurationLimit = 10;

  networking.domain = "vps.ovh.us";

  networking.networkmanager.enable = true;

  networking.useNetworkd = true;
  networking.interfaces.ens3.useDHCP = true;

  time.timeZone = "America/Denver";

  i18n.defaultLocale = "en_US.UTF-8";

  i18n.extraLocaleSettings = {
    LC_ADDRESS = "en_US.UTF-8";
    LC_IDENTIFICATION = "en_US.UTF-8";
    LC_MEASUREMENT = "en_US.UTF-8";
    LC_MONETARY = "en_US.UTF-8";
    LC_NAME = "en_US.UTF-8";
    LC_NUMERIC = "en_US.UTF-8";
    LC_PAPER = "en_US.UTF-8";
    LC_TELEPHONE = "en_US.UTF-8";
    LC_TIME = "en_US.UTF-8";
  };

  services.getty.autologinUser = "admin";

  # The shared openssh module defaults AllowUsers to [ "jacob" ]; aedilis only has admin.
  services.openssh.settings.AllowUsers = [ "admin" ];

  services.tailscale.enable = true;
  services.tailscale.extraSetFlags = [ "--webclient" ];

  # Allow Caddy to obtain a Tailscale TLS cert (used for Tailscale-only vhosts).
  systemd.services.tailscaled.environment.TS_PERMIT_CERT_UID = "caddy";

  nixpkgs.config.allowUnfree = true;

  # Match the installed base image to avoid state migration surprises.
  system.stateVersion = "23.11";
}
