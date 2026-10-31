# opencode — feature aggregate. Preserves the `nixos.opencode` import name.
#
# The web server itself is the home-manager `programs.opencode.web` user service
# in modules/home/jacob-nixos.nix (standalone jacob@nixos homeConfiguration — not
# importable from here); this feature owns the NixOS side: the catalog entry and
# the host-level Caddy settings.
{ inputs, ... }:
{
  flake.modules.nixos.opencode = {
    imports = with inputs.self.modules.nixos; [
      opencode-catalog
      opencode-caddy-host
    ];
  };
}
