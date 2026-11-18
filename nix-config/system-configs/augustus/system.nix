{ inputs, ... }:
{
  flake.modules.nixos.host-augustus-system =
    {
      inputs,
      lib,
      config,
      pkgs,
      ...
    }:
    {
      # Boot (system-boot-systemd), networking/DNS (system-networking), locale
      # (system-locale), allowUnfree (system-nix-base), and the tailscale sysctls
      # (system-networking-forwarding) come from modules/system — wired in
      # default.nix. Only augustus-specific settings live here.

      hardware.bluetooth = {
        enable = false;
      };

      environment.sessionVariables = {
        CA_URL = "https://ca.plato-splunk.media";
        CA_FINGERPRINT = "56c220018d0c65d5283d46d7c769eb471c18b2e903b205a9457261b2c52f2392";
      };

      services.getty.autologinUser = "jacob";

      services.caddy.useInternalCA = true;

      # Caddy OpenTelemetry tracing (Augustus-only, exports to local Tempo)
      systemd.services.caddy.environment = {
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = "http://127.0.0.1:4317";
        OTEL_EXPORTER_OTLP_PROTOCOL = "grpc";
        OTEL_SERVICE_NAME = "caddy";
      };

      services.xserver.xkb = {
        layout = "us";
        variant = "";
      };

      # Failure notification service (direct to Pushover). The credentials
      # are resolved at service start by the module's SecretSpec exec wrapper
      # (scope failure-notifs-augustus; both secrets declared as_path = true
      # in ./secretspec.toml) — no sops.secrets declarations and no
      # /run/secrets files for this service. ./secrets/failure-notifs.yaml
      # remains the interim encrypted STORAGE the wrapper's sops provider
      # reads (Phase 4 flips the chain to the service's 1Password SA).
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
    };
}
