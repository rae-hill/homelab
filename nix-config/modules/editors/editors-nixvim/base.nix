let
  module =
    { ... }:
    {
      programs.nixvim = {
        enable = true;

        nixpkgs = {
          config = {
            allowUnfree = true;
          };
        };

        globalOpts = {
          number = true;
          relativenumber = true;

          signcolumn = "yes";

          tabstop = 2;
          shiftwidth = 2;
          expandtab = true;
          smarttab = true;

          cursorline = true;

          wrap = false;
        };

        globals.mapleader = " ";
      };
    };
in
{
  flake.modules.homeManager.nixvim-base = module;
  flake.modules.darwin.nixvim-base = module;
}
