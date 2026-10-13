{
  flake.modules.homeManager.desktop-theming =
    {
      inputs,
      lib,
      config,
      pkgs,
      ...
    }:
    {
      catppuccin = {
        enable = true;
        flavor = "frappe";
        accent = "sapphire";
        # starship theming is applied via an inlined palette in the host home
        # config (programs.starship.settings) rather than catppuccin.starship,
        # because the catppuccin starship module uses Import-From-Derivation
        # (lib.importTOML on a built source), which breaks `nix flake check
        # --no-build` (the lint-staged pre-commit hook). Keep it off here.
        starship.enable = false;
        kitty.enable = true;
        ghostty.enable = true;
        vivaldi.enable = true;
        mangohud.enable = true;
      };
    };
}
