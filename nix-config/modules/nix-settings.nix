{
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
}
