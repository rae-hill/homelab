{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.shell-zsh =
    { inputs, ... }:
    {
      programs.zsh.enable = true;
    };
}
