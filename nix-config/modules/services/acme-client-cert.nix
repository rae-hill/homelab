{ config, ... }:
let
  c = config.constants;
in
{
  flake.modules.nixos.acme-client-cert =
    {
      pkgs-unstable,
      lib,
      config,
      ...
    }:
    {

    };
}
