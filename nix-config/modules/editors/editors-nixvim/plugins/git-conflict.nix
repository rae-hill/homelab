let
  module =
    { ... }:
    {
      programs.nixvim.plugins.git-conflict = {
        enable = true;
      };
    };
in
{
  flake.modules.homeManager.nixvim-git-conflict = module;
  flake.modules.darwin.nixvim-git-conflict = module;
}
