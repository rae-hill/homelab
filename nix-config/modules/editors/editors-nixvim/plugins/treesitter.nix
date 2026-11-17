let
  module =
    { ... }:
    {
      programs.nixvim.plugins = {
        treesitter = {
          enable = true;
        };

        ts-autotag = {
          enable = true;
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-treesitter = module;
  flake.modules.darwin.nixvim-treesitter = module;
}
