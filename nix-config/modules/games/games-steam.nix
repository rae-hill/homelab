{ inputs, ... }:
{
  # NixOS System
  flake.modules.nixos.games-steam = { pkgs, ... }: {
    programs.steam = {
      enable = true;
      gamescopeSession.enable = true;
      remotePlay.openFirewall = true;
    };

    programs.gamemode.enable = true;
  };

  # Home-Manager
  flake.modules.homeManager.games-steam =
    { inputs, pkgs, ... }:
    {
      home.packages = with pkgs; [
        steam
        protonup-ng
      ];

      home.sessionVariables = {
        STEAM_EXTRA_COMPAT_TOOLS_PATHS = "\${HOME}/.steam/root/compatibilitytools.d";
      };
    };
}
