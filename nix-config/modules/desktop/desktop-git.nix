# Base Git setup shared by desktop users (split from the old
# programs/git.nix). Per-user extras (identity, SSH signing) live in
# home-configs/rae/git.nix.
{ inputs, ... }:
{
  flake.modules.homeManager.desktop-git =
    {
      inputs,
      lib,
      config,
      pkgs,
      ...
    }:
    {
      programs.git = {
        enable = true;

        settings = {
          init = {
            defaultBranch = "main";
          };

          pull = {
            rebase = true;
          };

          core = {
            editor = "nvim";
          };

          push = {
            autoSetupRemote = true;
          };
        };
      };
    };
}
