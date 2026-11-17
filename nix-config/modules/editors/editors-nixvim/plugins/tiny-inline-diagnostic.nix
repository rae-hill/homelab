let
  module =
    { ... }:
    {
      programs.nixvim.plugins.tiny-inline-diagnostic = {
        enable = true;
        settings = {
          preset = "modern";
          option.use_icons_from_diagnostic = true;
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-tiny-inline-diagnostic = module;
  flake.modules.darwin.nixvim-tiny-inline-diagnostic = module;
}
