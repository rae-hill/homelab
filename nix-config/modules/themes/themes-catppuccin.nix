{ inputs, ... }:
{
  flake.modules.homeManager.themes-catppuccin =
    { inputs, pkgs, ... }:
    {
      catppuccin = {
        enable = true;
        flavor = "frappe";
        accent = "sapphire";
        kitty.enable = true;
        ghostty.enable = true;
        vivaldi.enable = true;
        mangohud.enable = true;
        # has issues with flake checks, see shell-starship.nix
        starship.enable = false;
      };
    };
}
