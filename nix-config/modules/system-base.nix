# Base system configuration, shared by every host.
#
# - flake.modules.nixos.nix-settings  — nix daemon settings, registry, gc (NixOS)
# - flake.modules.nixos.system-base   — the aggregate every linux host imports
#                                       (nix-settings + openssh + ssh-cert-renewer)
# - flake.modules.darwin.darwin-base  — nix-darwin counterpart of nix-settings
{ inputs, ... }:
{
  flake.modules.darwin.darwin-base =
    {
      inputs,
      lib,
      config,
      ...
    }:
    let
      flakeInputs = lib.filterAttrs (_: lib.isType "flake") inputs;
    in
    {
      nix = {
        settings = {
          experimental-features = "nix-command flakes";
          flake-registry = "";
          nix-path = config.nix.nixPath;
          allowed-users = [ "@wheel" ];
        };

        channel.enable = false;

        gc = {
          automatic = true;
          options = "--delete-older-than 30d";
        };

        optimise = {
          automatic = true;
        };

        registry = lib.mapAttrs (_: flake: { inherit flake; }) flakeInputs;
        nixPath = lib.mapAttrsToList (n: _: "${n}=flake:${n}") flakeInputs;
      };
    };

  flake.modules.nixos.nix-settings =
    {
      inputs,
      lib,
      config,
      ...
    }:
    let
      flakeInputs = lib.filterAttrs (_: lib.isType "flake") inputs;
    in
    {
      nix = {
        settings = {
          experimental-features = "nix-command flakes pipe-operators";
          flake-registry = "";
          allowed-users = [ "@wheel" ];
          trusted-users = [
            "jacob"
            "admin"
          ];
        };

        channel.enable = false;

        gc = {
          automatic = true;
          dates = "weekly";
          options = "--delete-older-than 30d";
        };

        optimise = {
          automatic = true;
          dates = [ "03:00" ];
        };

        registry = lib.mapAttrs (_: flake: { inherit flake; }) flakeInputs;
        nixPath = lib.mapAttrsToList (n: _: "${n}=flake:${n}") flakeInputs;
      };
    };

  flake.modules.nixos.system-base = {
    imports = with inputs.self.modules.nixos; [
      nix-settings
      openssh
      ssh-cert-renewer
    ];
  };
}
