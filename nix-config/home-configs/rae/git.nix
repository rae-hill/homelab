{ inputs, ... }:
{
  # Rae-specific Git extras: SSH signing + identity (split from the old
  # modules/programs/program-git.nix; base settings live in desktop-git).
  flake.modules.homeManager.rae-git =
    {
      inputs,
      lib,
      config,
      pkgs,
      ...
    }:
    {
      programs.git = {
        signing = {
          format = "ssh";
          key = "~/.ssh/id_ed25519_signing";
          signByDefault = true;
        };

        settings = {
          gpg = {
            format = "ssh";
          };

          commit = {
            gpgsign = true;
          };

          user = {
            signingkey = "~/.ssh/id_ed25519_signing";
            name = "Jacob Alford";
            email = "github.scouting378@passmail.net";
          };
        };
      };
    };
}
