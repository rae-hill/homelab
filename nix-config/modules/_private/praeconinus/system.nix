{
  lib,
  config,
  pkgs,
  ...
}:
{
  boot.loader.grub.enable = false;
  boot.loader.generic-extlinux-compatible.enable = true;
  # Bound the number of generations kept in /boot. extlinux copies each
  # generation's kernel + initrd into the (small) boot partition, so an
  # unbounded list can fill it over time. Mirrors the systemd-boot hosts.
  boot.loader.generic-extlinux-compatible.configurationLimit = 10;

  networking.networkmanager.enable = true;

  services.resolved = {
    enable = true;
    settings.Resolve = {
      DNS = [
        "45.90.28.0#praeconinus-cbc883.dns.nextdns.io"
        "2a07:a8c0::#praeconinus-cbc883.dns.nextdns.io"
        "45.90.30.0#praeconinus-cbc883.dns.nextdns.io"
        "2a07:a8c1::#praeconinus-cbc883.dns.nextdns.io"
      ];
      FallbackDNS = [
        "45.90.28.103"
        "45.90.30.103"
      ];
      Domains = [ "~." ];
      DNSSEC = "true";
      DNSOverTLS = "yes";
    };
  };

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

  services.getty.autologinUser = "jacob";

  services.tailscale.enable = true;
  services.tailscale.extraSetFlags = [ "--webclient" ];

  systemd.services.tailscaled.environment.TS_PERMIT_CERT_UID = "caddy";

  environment.etc."sysctl.d/99-tailscale.conf".text = ''
    net.ipv4.ip_forward = 1
    net.ipv6.conf.all.forwarding = 1
  '';

  nixpkgs.config.allowUnfree = true;

  system.stateVersion = "25.05";
}
