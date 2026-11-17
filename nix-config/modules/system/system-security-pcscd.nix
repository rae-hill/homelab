{ inputs, ... }:
{
  # NixOS — pcscd (smartcard daemon) + the polkit rules letting local users
  # access PC/SC without authentication. Extracted from cicero's inline
  # security.nix; wired on cicero only (step-ca YubiKey operations).
  flake.modules.nixos.system-security-pcscd =
    { ... }:
    {
      services.pcscd.enable = true;

      security.polkit.extraConfig = ''
        polkit.addRule(function(action, subject) {
          if (action.id == "org.debian.pcsc-lite.access_card") {
            return polkit.Result.YES;
          }
        });

        polkit.addRule(function(action, subject) {
          if (action.id == "org.debian.pcsc-lite.access_pcsc") {
            return polkit.Result.YES;
          }
        });
      '';
    };
}
