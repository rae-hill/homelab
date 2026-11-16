{ inputs, ... }:
{
  flake.modules.nixos.opencode-theme =
    { pkgs, pkgs-unstable, ... }:
    {
      # OpenCode V2 keeps terminal-client settings (theme, ...) in cli.json;
      # the catppuccin home-manager module (release-26.05) still writes the
      # V1-era tui.json, which V2 ignores. Mirror the theme here so
      # catppuccin-frappe keeps applying.
      xdg.configFile."opencode/cli.json".text = builtins.toJSON {
        theme = {
          name = "catppuccin-frappe";
          mode = "dark";
        };
      };
    };
}
