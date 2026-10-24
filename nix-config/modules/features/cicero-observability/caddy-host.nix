# cicero-observability — host-level Caddy + ACME settings the catalog can't express.
#
# The per-entry listenPort = 8443 keys each vhost as https://<fqdn>:8443, but the GLOBAL
# `https_port 8443` + `useInternalCA` + `services.caddy.enable` are whole-host settings (§7.6:
# a non-443 https_port is a host property, not a service one). step-ca owns :443, so Caddy
# runs on :8443. Also carries the security.acme defaults and the cicero-observability cert
# group (the Alloy client cert's group — Alloy joins it; Caddy does not read this cert).
#
# See docs/service-consolidation/cicero-observability.md §2.2.
{ config, inputs, ... }:
let
  c = config.constants;
in
{
  flake.modules.nixos.cicero-observability-caddy-host =
    { ... }:
    {
      imports = [ inputs.self.modules.nixos.caddy ];

      services.caddy = {
        enable = true;
        globalConfig = ''
          https_port 8443
        '';
        useInternalCA = true;
      };

      security.acme = {
        acceptTerms = true;
        defaults.email = c.acme.email;
      };

      # The Alloy client cert group (Alloy joins it via SupplementaryGroups; not read by Caddy).
      users.groups.cicero-observability = { };
    };
}
