{ inputs, ... }:
{
  flake.modules.homeManager.rae = {
    imports = with inputs.self.modules.homeManager; [
      desktop-complete
      desktop-gnome-complete
      desktop-git
      games-complete
      shell-complete
      rae-git
      rae-shell
      rae-sops
    ];

    home.stateVersion = "24.05";

    home = {
      username = "rae";
      homeDirectory = "/home/rae";
    };
  };
}
