let
  module =
    { ... }:
    {
      programs.nixvim.plugins.barbar = {
        enable = true;
        autoLoad = true;
      };
    };
in
{
  flake.modules.homeManager.nixvim-barbar = module;
  flake.modules.darwin.nixvim-barbar = module;
}
