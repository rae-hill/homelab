{ inputs, ... }:
{
  flake.modules.nixos.host-aedilis-programs =
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
        openssl
        oath-toolkit
        step-cli
      ];
    };
}
