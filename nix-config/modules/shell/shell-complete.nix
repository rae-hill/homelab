# Shell aggregate (home-manager).
{ inputs, ... }:
{
  flake.modules.homeManager.shell-complete = {
    imports = with inputs.self.modules.homeManager; [
      shell-starship
    ];
  };
}
