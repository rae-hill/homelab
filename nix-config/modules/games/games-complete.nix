# Games aggregate (home-manager).
{ inputs, ... }:
{
  flake.modules.homeManager.games-complete = {
    imports = with inputs.self.modules.homeManager; [
      games-steam
      games-mangohud
    ];
  };
}
