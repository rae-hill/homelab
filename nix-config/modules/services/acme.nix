{ config, ... }:
let
  c = config.constants;
  letsEncryptDirectory = "https://acme-v02.api.letsencrypt.org/directory";
in
{
  flake.modules.nixos.acme =
    {
      config,
      lib,
      ...
    }:
    let
      cfg = config.services.homelab-acme;
    in
    {
      options.services.homelab-acme = {
        defaultCA = lib.mkOption {
          type = lib.types.enum [
            "internal"
            "letsencrypt"
          ];
          default = "internal";
          description = ''
            Which ACME CA to use as the `security.acme` default.
            - `internal`: the homelab step-ca (for Tailscale-only / internal certs).
            - `letsencrypt`: public Let's Encrypt production (for internet-facing certs).

            Per-cert overrides via `security.acme.certs.<name>.server` still apply, so a
            host that needs BOTH internal and public certs can set whichever is the
            common case here and override the exceptions per-cert.
          '';
        };

        email = lib.mkOption {
          type = lib.types.str;
          default = c.acme.email;
          description = "Default contact email for ACME account registration.";
        };

        internalListenHTTP = lib.mkOption {
          type = lib.types.str;
          default = "127.0.0.1:1360";
          description = "Default HTTP-01 challenge listener for internal (step-ca) certs.";
        };
      };

      config = {
        security.acme = {
          acceptTerms = true;
          defaults.email = cfg.email;
          defaults.server =
            if cfg.defaultCA == "letsencrypt" then letsEncryptDirectory else c.ca.acmeDirectory;
          # Only set the loopback challenge listener when defaulting to internal
          # step-ca; public Let's Encrypt certs set their own listenHTTP/dnsProvider
          # per-cert (HTTP-01 on a public-reachable path).
          defaults.listenHTTP = lib.mkIf (cfg.defaultCA == "internal") cfg.internalListenHTTP;
        };
      };
    };
}
