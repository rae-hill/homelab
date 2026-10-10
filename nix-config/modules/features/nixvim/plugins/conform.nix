let
  module =
    { pkgs, ... }:
    {
      programs.nixvim.plugins.conform-nvim = {
        enable = true;

        settings = {
          # Formatters keyed by filetype. Nix uses the canonical `nixfmt` (RFC style)
          # so editor output matches the CLI/pre-commit path (lint-staged runs the
          # same `nixfmt` on staged .nix files). Other filetypes continue to format
          # via the dprint LSP (see nixvim-lsp) through the shared format keymap.
          formatters_by_ft = {
            nix = [ "nixfmt" ];
          };

          # Make the bundled `nixfmt` explicit so it does not depend on PATH.
          formatters = {
            nixfmt = {
              command = "${pkgs.nixfmt}/bin/nixfmt";
            };
          };
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-conform = module;
  flake.modules.darwin.nixvim-conform = module;
}
