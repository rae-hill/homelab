let
  module =
    { ... }:
    {
      programs.nixvim.colorschemes.catppuccin = {
        enable = true;
        settings = {
          flavor = "frappe";
          integrations = {
            notify = true;
            neotree = true;
            treesitter = true;
            treesitter_context = true;
            native_lsp = {
              enabled = true;
              inlay_hints = {
                background = true;
              };
              underlines = {
                errors = [ "underline" ];
                hints = [ "underline" ];
                information = [ "underline" ];
                warnings = [ "underline" ];
              };
            };
          };
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-colorscheme = module;
  flake.modules.darwin.nixvim-colorscheme = module;
}
