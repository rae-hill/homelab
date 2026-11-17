{ lib, config, pkgs, ... }:
{
  programs.git.enable = true;

  programs.zsh.enable = true;

  environment.systemPackages = with pkgs; [
    vim
    yubikey-manager
    step-cli
  ];
}
