{ inputs, ... }:
{
  # NixOS
  # enables building for other platforms besides x86-64
  flake.modules.nixos.system-emulation = { pkgs, ... }: {
    boot.binfmt.emulatedSystems = [ "aarch64-linux" ];

    environment.systemPackages = with pkgs; [
      quickemu
    ];
  };
}
