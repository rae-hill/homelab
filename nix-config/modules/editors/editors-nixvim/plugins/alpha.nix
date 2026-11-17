let
  module =
    { ... }:
    {
      programs.nixvim.plugins.alpha = {
        enable = true;
        theme = "dashboard";
      };
    };
in
{
  flake.modules.homeManager.nixvim-alpha = module;
  flake.modules.darwin.nixvim-alpha = module;
}
