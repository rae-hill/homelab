{
  flake.modules.nixos.desktop-zoom =
    { inputs, pkgs-unstable, ... }:
    {
      # No home-manager module :(
      programs.zoom-us = {
        enable = true;
        package = pkgs-unstable.zoom-us;
      };
    };
}
