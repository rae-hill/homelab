{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.shell-zsh =
    { inputs, ... }:
    {
      programs.zsh.enable = true;
    };

  # Home-Manager — base zsh setup (merged from the old programs/zsh.nix).
  # Per-user aliases live in home-configs/rae/shell.nix.
  flake.modules.homeManager.shell-zsh =
    {
      inputs,
      lib,
      config,
      pkgs,
      ...
    }:
    {
      programs.zsh = {
        enable = true;
        enableCompletion = true;
        autosuggestion.enable = true;
        syntaxHighlighting.enable = true;

        oh-my-zsh = {
          enable = true;
          plugins = [ "git" ];
        };
      };
    };
}
