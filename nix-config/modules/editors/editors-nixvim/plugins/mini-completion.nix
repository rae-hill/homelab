let
  module =
    { ... }:
    {
      programs.nixvim.plugins.mini-completion = {
        enable = true;
      };
    };
in
{
  flake.modules.homeManager.nixvim-mini-completion = module;
  flake.modules.darwin.nixvim-mini-completion = module;
}
