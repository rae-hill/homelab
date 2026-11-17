{ inputs, ... }:
{
  flake.modules.nixos.host-aedilis-system =
    {
      lib,
      config,
      pkgs,
      ...
    }:
    {
      # Boot (system-boot-base + system-boot-grub), networking/DNS
      # (system-networking-dns-host: aedilis IS the resolver, so it points at
      # 127.0.0.1), locale (system-locale), and allowUnfree (system-nix-base)
      # come from modules/system — wired in default.nix. Only aedilis-specific
      # (OVH VPS) settings live here.

      # OVHCloud base-image settings (preserved from the provisioned configuration.nix)
      # Workaround for https://github.com/NixOS/nix/issues/8502
      services.logrotate.checkConfig = false;
      zramSwap.enable = true;

      networking.domain = "vps.ovh.us";

      networking.useNetworkd = true;
      networking.interfaces.ens3.useDHCP = true;
      # OVH IPv6. OVH VPS does not auto-configure IPv6 (no DHCPv6/SLAAC); the address
      # and gateway must be set statically from the OVH dashboard values. OVH assigns
      # the address as a /128 and treats the gateway as OFF-link — the gateway is not
      # reachable via the on-link prefix — so the default route must be marked on-link
      # (`options.onlink`). This mirrors OVH's documented recipe:
      #   ip -6 route add <gw> dev ens3
      #   ip -6 route add default via <gw> dev ens3
      #
      #   IP:      2604:2dc0:222::64d  (OVH dashboard)
      #   Gateway: 2604:2dc0:222::1    (OVH dashboard)
      #
      # Expressed via the native `networking.interfaces` options so it merges cleanly
      # into the systemd-networkd `40-ens3` unit NixOS generates for this interface
      # (do NOT hand-write `systemd.network.networks."40-ens3"` — it would collide).
      #
      # Without this, the published AAAA resolves to an address nothing answers on, and
      # happy-eyeballs clients stall on IPv6 before falling back to IPv4 — which is
      # what broke DoH/DoT/DoQ for v6-capable clients.
      networking.interfaces.ens3.ipv6 = {
        addresses = [
          {
            address = "2604:2dc0:222::64d";
            prefixLength = 128;
          }
        ];
        routes = [
          {
            address = "::";
            prefixLength = 0;
            via = "2604:2dc0:222::1";
            options.onlink = "";
          }
        ];
      };

      services.getty.autologinUser = "admin";

      # The shared openssh module defaults AllowUsers to [ "jacob" ]; aedilis only has admin.
      services.openssh.settings.AllowUsers = [ "admin" ];

      # Match the installed base image to avoid state migration surprises.
      system.stateVersion = "23.11";
    };
}
