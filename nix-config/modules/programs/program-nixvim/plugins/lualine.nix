let
  module =
    { ... }:
    {
      programs.nixvim.plugins.lualine = {
        enable = true;
      };
    };
in
{
  flake.modules.homeManager.nixvim-lualine = module;
  flake.modules.darwin.nixvim-lualine = module;
}
