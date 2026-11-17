{
  flake.modules.homeManager.vscode =
    { inputs, lib, config, pkgs, pkgs-unstable, ... }:
    {
      programs.vscode = {
        enable = true;
        package = pkgs-unstable.vscode;

        profiles = {
          default = {
            extensions = with pkgs-unstable.vscode-extensions; [
              catppuccin.catppuccin-vsc
              streetsidesoftware.code-spell-checker
              dbaeumer.vscode-eslint
              esbenp.prettier-vscode
              vscodevim.vim
              rust-lang.rust-analyzer
              haskell.haskell
              davidanson.vscode-markdownlint
              elmtooling.elm-ls-vscode
              unifiedjs.vscode-mdx
              jnoortheen.nix-ide
              github.copilot
              github.copilot-chat
              arrterian.nix-env-selector
              vue.volar
              vue.vscode-typescript-vue-plugin
              lokalise.i18n-ally
            ];
            userSettings = {
              "editor.fontFamily" = "Victor Mono";
              "editor.snippetSuggestions" = "none";
              "editor.inlayHints.enabled" = "off";
              "terminal.integrated.fontFamily" = "Victor Mono";
              "files.insertFinalNewline" = true;
              "editor.fontLigatures" = true;
              "editor.formatOnSave" = true;
              "editor.suggest.showWords" = false;
              "editor.acceptSuggestionOnCommitCharacter" = false;
              "emmet.showExpandedAbbreviation" = "never";
              "editor.renderLineHighlight" = "none";

              "editor.scrollbar.vertical" = "hidden";
              "window.commandCenter" = false;
              "window.titleBarStyle" = "custom";
              "breadcrumbs.enabled" = true;
              "workbench.sideBar.location" = "right";
              "workbench.statusBar.visible" = true;
              "workbench.startupEditor" = "none";
              "workbench.tree.indent" = 22;
              "workbench.tree.renderIndentGuides" = "onHover";

              "editor.tabSize" = 2;
              "editor.bracketPairColorization.enabled" = true;
              "editor.detectIndentation" = false;
              "javascript.suggest.autoImports" = false;
              "typescript.suggest.autoImports" = false;
              "typescript.preferences.importModuleSpecifier" = "relative";
              "editor.lineNumbers" = "relative";

              "editor.defaultFormatter" = "esbenp.prettier-vscode";

              "editor.tokenColorCustomizations" = {
                "textMateRules" = [
                  {
                    "scope" = [
                      "comment"
                      "storage.modifier"
                      "storage.type.php"
                      "keyboard.other.new.php"
                      "entity.other.attribute-name"
                      "fenced_code.block.language.markdown"
                      "keyboard"
                      "storage.modifier"
                      "storage.type"
                      "keyboard.control"
                      "constant.language"
                      "entity.other.attribute-name"
                      "entity.name.method"
                      "keyboard.control.import.ts"
                      "keyboard.control.import.tsx"
                      "keyboard.control.import.js"
                      "keyboard.control.flow.js"
                      "keyboard.control.from.js"
                      "keyboard.control.from.ts"
                      "keyboard.control.from.tsx"
                    ];
                    "settings" = {
                      "fontStyle" = "italic";
                    };
                  }
                ];
              };

              "workbench.colorTheme" = "Catppuccin Frappé";
              "workbench.iconTheme" = "catppuccin-frappe";
            };
          };
        };
      };
    };
}
