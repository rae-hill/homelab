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

      # Failure notification service (direct to Pushover)
      services.failure-notifs = {
        enable = true;
        userKeyFile = config.sops.secrets.pushover_user_key.path;
        tokenFile = config.sops.secrets.pushover_token.path;
        # Services not owned by a specific module, or shared across hosts
        attachServices = [
          "caddy"
          "homelab-api"
          "homelab-secret-provisioner"
          "tailscaled"
        ];
      };

      # Host-level Pushover credentials for failure-notifs above, from the
      # failure-notifs per-service sops file (moved from augustus/sops.nix).
      sops.secrets = {
        pushover_user_key = {
          sopsFile = inputs.self + "/nix-config/secrets/augustus/failure-notifs.yaml";
          owner = "root";
        };
        pushover_token = {
          sopsFile = inputs.self + "/nix-config/secrets/augustus/failure-notifs.yaml";
          owner = "root";
        };
      };

      system.stateVersion = "25.05";
    };
}
