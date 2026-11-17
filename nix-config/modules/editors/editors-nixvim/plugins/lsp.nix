let
  module =
    { pkgs, ... }:
    {
      programs.nixvim.plugins.lsp = {
        enable = true;
        inlayHints = true;
        servers = {
          ts_ls.enable = true;
          eslint = {
            enable = true;
            settings = {
              packageManager = "yarn";
              nodePath = ".yarn/sdks";
            };
          };
          cssls.enable = true;
          tailwindcss.enable = true;
          html.enable = true;
          astro.enable = true;
          phpactor.enable = true;
          svelte.enable = false;
          pyright.enable = true;
          marksman.enable = true;
          nil_ls = {
            enable = true;
            settings.nix.flake.autoArchive = true;
          };
          dockerls.enable = true;
          bashls.enable = true;
          clangd.enable = true;
          yamlls.enable = true;

          lua_ls = {
            enable = true;
            settings.telemetry.enable = false;
          };

          rust_analyzer = {
            enable = true;
            installRustc = true;
            installCargo = true;
          };

          dprint = {
            enable = true;
            filetypes = [
              "typescript"
              "typescriptreact"
              "javascript"
              "javascriptreact"
              "json"
              "astro"
            ];
            extraOptions = {
              init_options = {
                plugins = with pkgs.dprint-plugins; [
                  "${dprint-plugin-typescript}/plugin.wasm"
                  "${dprint-plugin-json}/plugin.wasm"
                  "${dprint-plugin-markdown}/plugin.wasm"
                  "${dprint-plugin-toml}/plugin.wasm"
                  "${g-plane-malva}/plugin.wasm"
                  "${g-plane-markup_fmt}/plugin.wasm"
                  "${g-plane-pretty_yaml}/plugin.wasm"
                ];
              };
            };
          };
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-lsp = module;
  flake.modules.darwin.nixvim-lsp = module;
}
