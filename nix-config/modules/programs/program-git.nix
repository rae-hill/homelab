{
  flake.modules.homeManager.git =
    { inputs, lib, config, pkgs, ... }:
    {
      programs.git = {
        enable = true;
        signing = {
          format = "ssh";
          key = "~/.ssh/id_ed25519_signing";
          signByDefault = true;
        };
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
