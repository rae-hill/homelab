let
  module =
    { ... }:
    {
      programs.nixvim.plugins.notify = {
        enable = true;
        settings = {
          top_down = true;
          fps = 60;
          render = "default";
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-notify = module;
  flake.modules.darwin.nixvim-notify = module;
}
