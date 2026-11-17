let
  module =
    { ... }:
    {
      programs.nixvim.plugins.smart-splits = {
        enable = true;
      };
    };
in
{
  flake.modules.homeManager.nixvim-smart-splits = module;
  flake.modules.darwin.nixvim-smart-splits = module;
}
