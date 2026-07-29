{ config, ... }:
{
  flake.modules.darwin.homebrew =
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
