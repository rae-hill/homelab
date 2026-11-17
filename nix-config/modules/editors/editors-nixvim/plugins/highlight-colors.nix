let
  module =
    { ... }:
    {
      programs.nixvim.plugins.highlight-colors = {
        enable = true;
        settings = {
          enable_named_colors = true;
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-highlight-colors = module;
  flake.modules.darwin.nixvim-highlight-colors = module;
}
