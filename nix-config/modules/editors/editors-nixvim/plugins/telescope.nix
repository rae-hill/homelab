let
  module =
    { ... }:
    {
      programs.nixvim.plugins.telescope = {
        enable = true;
        keymaps = {
          "<C-p>" = "find_files";
          "<C-f>" = "live_grep";
          "<C-S-f>" = "grep_string";
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-telescope = module;
  flake.modules.darwin.nixvim-telescope = module;
}
