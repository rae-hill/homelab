{ inputs, ... }:
{
  flake.modules.homeManager.desktop-vivaldi =
    { pkgs, ... }:
    let
      vivaldiNvidia = pkgs.vivaldi.override {
        commandLineArgs = [
          "--ozone-platform=x11"
        ];
        enableWidevine = true;
      };
    in
    {
      home.packages = [
        vivaldiNvidia
      ];
    };
}
