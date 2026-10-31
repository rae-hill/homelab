# opencode — host-level Caddy settings for the nixos workstation (things the
# catalog can't express). nixos becomes an apphost for this one service: Caddy
# serves exactly one vhost (opencode, :443 tailscale0-only via the firewall
# generator). `useInternalCA` points Caddy's managed-cert issuance at the homelab
# step-ca, so the opencode vhost's server cert chains to alford-root — the same
# root the mTLS trust pool uses. The HTTP-01 challenge listener on :80 is opened
# on tailscale0 by hand in _private/nixos/security.nix (mirrors cicero).
#
# See docs/service-consolidation/opencode.md.
{ inputs, ... }:
{
  flake.modules.nixos.opencode-caddy-host =
    { ... }:
    {
      # services/caddy.nix contributes enable/package/logFormat and the
      # useInternalCA option (email + acmeCA when true).
      imports = [ inputs.self.modules.nixos.caddy ];

      services.caddy.useInternalCA = true;
    };
}
