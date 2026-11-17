{ inputs, ... }:
{
  # NixOS
  flake.modules.nixos.system-security = { pkgs, ... }: {
    security.sudo.execWheelOnly = true;

    security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];

    # yubikey client certs
    services.pcscd.enable = true;

    environment.etc."pkcs11/modules/opensc-pkcs11".text = ''
      module: ${pkgs.opensc}/lib/opensc-pkcs11.so
    '';

    networking.firewall = {
      enable = true;
    };
  };
}
