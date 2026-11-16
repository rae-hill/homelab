{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.system-fonts = { pkgs }: {
    fonts = {
      packages = with pkgs; [
        victor-mono
        noto-fonts
        noto-fonts-color-emoji
      ];

      fontconfig = {
        useEmbeddedBitmaps = true;
        defaultFonts = {
          serif = [ "noto-serif" ];
          sansSerif = [ "noto-sans-meetei-mayek" ];
          monospace = [ "victor-mono" ];
        };
      };
    };
  };
}
