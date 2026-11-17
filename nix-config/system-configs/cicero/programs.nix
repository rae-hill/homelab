{ inputs, ... }:
{
  flake.modules.nixos.host-cicero-programs =
    {
      lib,
      config,
      pkgs,
      ...
    }:
    {
      programs.git.enable = true;

      programs.zsh.enable = true;

      environment.systemPackages = with pkgs; [
        vim
        yubikey-manager
        step-cli
      ];
    };
}
