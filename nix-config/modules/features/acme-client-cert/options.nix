{ config, ... }:
let
  c = config.constants;
  acmeClientOptions = { lib }: {
    options.services.acme-client-cert = {
      enable = lib.mkEnableOption "Enables the system-level ACME cert renewer";

      certPath = lib.mkOption {
        type = lib.types.str;
        description = "The path to the client cert to be renewed";
      };

      ykSlot = lib.mkOption {
        type = lib.types.str;
        description = "The slot of the yubikey used to make the CSR";
      };

      ykPinFilePath = lib.mkOption {
        type = lib.types.str;
        description = "The path to the file containing the pincode of the yubikey";
      };
    };
  };
in
{
  flake.modules.nixos.acme-client-cert-options =
    {
      pkgs-unstable,
      lib,
      config,
      ...
    }:
    {
    };
}
