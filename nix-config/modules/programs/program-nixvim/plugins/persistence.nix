let
  module =
    { ... }:
    {
      programs.nixvim.plugins.persistence.enable = true;
    };
in
{
  flake.modules.homeManager.nixvim-persistence = module;
  flake.modules.darwin.nixvim-persistence = module;
}
