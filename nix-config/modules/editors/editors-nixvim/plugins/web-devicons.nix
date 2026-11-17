let
  module =
    { ... }:
    {
      programs.nixvim.plugins.web-devicons = {
        enable = true;
        settings = {
          strict = true;
          color_icons = true;
          variant = "dark";
        };
        autoLoad = true;
      };
    };
in
{
  flake.modules.homeManager.nixvim-web-devicons = module;
  flake.modules.darwin.nixvim-web-devicons = module;
}
