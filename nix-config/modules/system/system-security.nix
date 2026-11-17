{ inputs, ... }:
{
  # NixOS — baseline security shared by every host.
  flake.modules.nixos.system-security-base = { pkgs, ... }: {
    security.sudo.execWheelOnly = true;

    # Trust the internal root CA (step-ca-issued certs on Tailscale endpoints).
    security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];

    networking.firewall.enable = true;
  };

  # NixOS — smartcard support (YubiKey PIV/CCID client certs).
  flake.modules.nixos.system-security-smartcard = { pkgs, ... }: {
    services.pcscd.enable = true;

    environment.etc."pkcs11/modules/opensc-pkcs11".text = ''
      module: ${pkgs.opensc}/lib/opensc-pkcs11.so
    '';
  };

  # NixOS — full aggregate.
  flake.modules.nixos.system-security = {
    imports = with inputs.self.modules.nixos; [
      system-security-base
      system-security-smartcard
    ];
  };
}
