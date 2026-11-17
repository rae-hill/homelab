{ inputs, ... }:
{
  flake.modules.nixos.system-nix-base = {
    nixpkgs.config.allowUnfree = true;
  };

  flake.modules.homeManager.system-nix-base = {
    programs.home-manager.enable = true;

    systemd.user.startServices = "sd-switch";

    nixpkgs = {
      overlays = [ ];
      config = {
        allowUnfree = true;
        allowUnfreePredicate = _: true;
      };
    };
  };
}
