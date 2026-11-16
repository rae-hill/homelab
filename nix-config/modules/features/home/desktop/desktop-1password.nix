{ inputs, ... }:
{
  # NixOS System
  flake.modules.nixos.desktop-1password =
    { pkgs }:
    {
      programs._1password.enable = true;
    };

  flake.modules.nixos.desktop-1password-gui =
    { pkgs }:
    {
      imports = with inputs.self.modules.nixos; [
        desktop-1password
      ];

      programs._1password-gui = {
        enable = true;
        polkitPolicyOwners = [
          "jacob"
          "rae"
        ];
      };

      environment.etc."1password/custom_allowed_browsers" = {
        text = ''
          vivaldi-bin
          firefox
        '';
        mode = "0755";
      };
    };

  flake.modules.homeManager.desktop-1password-cli =
    { pkgs }:
    {
      home.packages = with pkgs; [
        _1password-cli
      ];
    };
}
