# IP forwarding for Tailscale routing/funnel hosts (augustus, praeconinus).
# Extracted from the identical inline `sysctl.d/99-tailscale.conf` blocks.
{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.system-networking-forwarding =
    { ... }:
    {
      environment.etc."sysctl.d/99-tailscale.conf".text = ''
        net.ipv4.ip_forward = 1
        net.ipv6.conf.all.forwarding = 1
      '';
    };
}
