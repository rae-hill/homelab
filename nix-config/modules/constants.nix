{ inputs, lib, ... }:
{
  options.constants = lib.mkOption {
    type = lib.types.attrs;
    default = { };
    description = "Shared constants available to all flake-parts modules";
  };

  options.flake.homeConfigurations = lib.mkOption {
    type = lib.types.attrsOf lib.types.raw;
    default = { };
    description = "Home Manager configurations keyed by user@host";
  };

  options.flake.modules = lib.mkOption {
    type = lib.types.attrsOf (lib.types.attrsOf lib.types.raw);
    default = { };
    description = "Named NixOS/homeManager/darwin module functions, keyed by class then aspect name";
  };

  config.constants = {
    hosts = {
      augustus = {
        system = "x86_64-linux";
      };
      cicero = {
        system = "x86_64-linux";
      };
      praeconinus = {
        system = "aarch64-linux";
      };
      nixos = {
        system = "x86_64-linux";
      };
      mini = {
        system = "aarch64-darwin";
      };
      aedilis = {
        system = "x86_64-linux";
      };
    };

    x509PermittedIps = [
      "100.69.89.38"
      "fd7a:115c:a1e0::601:5927"
      "100.104.220.114"
      "fd7a:115c:a1e0::6f01:dc8c"
      "100.95.250.77"
      "fd7a:115c:a1e0::6301:fa4d"
      "100.72.52.108"
      "fd7a:115c:a1e0::2801:3495"
      "100.111.29.21"
      "fd7a:115c:a1e0::db01:1d31"
      "100.75.173.123"
      "fd7a:115c:a1e0:ab12:4843:cd96:624b:ad7b"
      "100.99.178.23"
      "fd7a:115c:a1e0::b01:b217"
      "127.0.0.1"
      "::1"
    ];

    x509PermittedCommonNames = [
      "G1447DK9FP"
      "D2TN90JVJV"
    ];

    nvidia = {
      version = "595.99.02";
      sha256_64bit = "sha256-6HR3lYv3YwcFSTJL1a1slI66btIQ5EAFs+/4SUD24ew=";
      openSha256 = "sha256-T36x/jx8yQ8l3LFp1rZIrTfcSwbGy8YSAvXOUSptpb4=";
    };

    users = {
      jacob = {
        name = "jacob";
        uid = 1000;
      };
    };

    secretsDir = inputs.self + "/nix-config/secrets";
  };
}
