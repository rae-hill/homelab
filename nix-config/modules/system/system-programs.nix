{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.system-programs = { pkgs, ... }: {
    environment.systemPackages = with pkgs; [
      git
      vim
      openssl
      cifs-utils
      restic
      step-cli
    ];
  };
}
