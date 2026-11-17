{ config, ... }:
{
  flake.modules.darwin.desktop-homebrew =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      homebrew = {
        enable = true;
        enableZshIntegration = true;
      };
    };
}
