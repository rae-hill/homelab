let
  module =
    { ... }:
    {
      programs.nixvim.plugins.neo-tree = {
        enable = true;
        settings = {
          popup_border_style = "rounded";
          enable_diagnostics = true;
          enable_git_status = true;
          enable_modified_markers = true;
          enable_refresh_on_write = true;
          close_if_last_window = true;
          window = {
            width = 40;
            height = 15;
            autoExpandWidth = false;
            mappings = {
              "<space>" = "none";
            };
          };
          buffers = {
            bind_to_cwd = false;
            follow_current_file = {
              enabled = true;
            };
          };
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-neo-tree = module;
  flake.modules.darwin.nixvim-neo-tree = module;
}
