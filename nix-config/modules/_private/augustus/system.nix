{ lib, config, pkgs, ... }:
{
  boot.loader.systemd-boot.enable = true;
  boot.loader.efi.canTouchEfiVariables = true;

  boot.kernelPackages = pkgs.linuxPackages_latest;

  networking.networkmanager.enable = true;

  hardware.bluetooth = {
    enable = false;
  };

  environment.sessionVariables = {
    CA_URL = "https://ca.plato-splunk.media";
    CA_FINGERPRINT = "56c220018d0c65d5283d46d7c769eb471c18b2e903b205a9457261b2c52f2392";
  };

  services.resolved = {
    enable = true;
    settings.Resolve = {
      DNS = [
        "45.90.28.0#augustus-cbc883.dns.nextdns.io"
        "2a07:a8c0::#augustus-cbc883.dns.nextdns.io"
        "45.90.30.0#augustus-cbc883.dns.nextdns.io"
        "2a07:a8c1::#augustus-cbc883.dns.nextdns.io"
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

  services.caddy.useInternalCA = true;

  # Caddy OpenTelemetry tracing (Augustus-only, exports to local Tempo)
  systemd.services.caddy.environment = {
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://127.0.0.1:4317";
    OTEL_EXPORTER_OTLP_PROTOCOL = "grpc";
    OTEL_SERVICE_NAME = "caddy";
  };

  services.tailscale.enable = true;
  services.tailscale.extraSetFlags = [ "--webclient" ];

  environment.etc."sysctl.d/99-tailscale.conf".text = ''
    net.ipv4.ip_forward = 1
    net.ipv6.conf.all.forwarding = 1
  '';

  services.xserver.xkb = {
    layout = "us";
    variant = "";
  };

  nixpkgs.config.allowUnfree = true;

  # Failure notification service
  services.failure-notifs = {
    enable = true;
    # Services not owned by a specific module, or shared across hosts
    attachServices = [
      "caddy"
      "homelab-api"
      "homelab-secret-provisioner"
      "tailscaled"
    ];
  };

  system.stateVersion = "25.05";
}
