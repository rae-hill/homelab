{ inputs, ... }:
{
  flake.modules.homeManager.opencode-program =
    { pkgs, pkgs-unstable, ... }:
    {
      imports = with inputs.self.modules.homeManager; [
        opencode-formatter
        opencode-permissions
        opencode-theme
        opencode-web
        opencode-providers
      ];

      programs.opencode = {
        enable = true;
        package = pkgs-unstable.opencode;
      };
    };
}
