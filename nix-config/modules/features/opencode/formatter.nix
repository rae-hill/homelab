{ config, inputs, ... }:
let
  extensions = [ ];
  c = config.constants.dprint;
  dprintFileExtensions = [
    # dprint-plugin-typescript (js + ts)
    ".ts"
    ".tsx"
    ".mts"
    ".cts"
    ".js"
    ".jsx"
    ".mjs"
    ".cjs"
    # dprint-plugin-json
    ".json"
    ".jsonc"
    # dprint-plugin-markdown
    ".md"
    # dprint-plugin-toml
    ".toml"
    # malva (CSS)
    ".css"
    ".scss"
    ".less"
    # markup_fmt (HTML/XML/Vue/Svelte/Astro)
    ".html"
    ".htm"
    ".xml"
    ".vue"
    ".svelte"
    ".astro"
    # pretty_yaml
    ".yaml"
    ".yml"
  ];
in
{
  flake.modules.homeManager.opencode-formatter =
    { pkgs, pkgs-unstable, ... }:
    {
      programs.opencode.settings.formatter = {
        prettier.disabled = true;
        oxfmt.disabled = true;
        biome.disabled = true;

        nixfmt.command = [
          "${pkgs.nixfmt}/bin/nixfmt"
          "$FILE"
        ];

        dprint = {
          command = [
            "${pkgs.dprint}/bin/dprint"
            "fmt"
            "--allow-no-files"
            "--plugins"
          ]
          ++ c.dprintPluginPaths pkgs
          ++ [
            "--"
            "$FILE"
          ];

          extensions = dprintFileExtensions;

          environment = {
            DPRINT_CACHE_DIR = "/home/rae/.cache/dprint";
          };
        };
      };
    };
}
