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

  # Global, cross-host aggregate of each catalog service's DNS fact. Unlike the per-host
  # `homelab.catalog` NixOS option (which only exists on the host that imports the service
  # module), this is a FLAKE-LEVEL option merged across ALL modules regardless of host — so the
  # aedilis `homelab-service-dns` generator can emit records for services running on every host.
  # Each service's features/<svc>/catalog.nix contributes one entry at the flake-parts level,
  # alongside its per-host `homelab.catalog.<name>` entry. Value shape:
  #   { subdomain; zone; host; record = { tailnet = {}; } | { cname = { target; }; }
  #                                    | { public = { v4; v6; }; }; }
  options.flake.catalogDns = lib.mkOption {
    type = lib.types.attrsOf lib.types.raw;
    default = { };
    description = "Cross-host aggregate of catalog service DNS facts, consumed by homelab-service-dns.";
  };

  config.constants = {
    hosts = {
      augustus = {
        system = "x86_64-linux";
        tailscale = {
          v4 = "100.95.250.77";
          v6 = "fd7a:115c:a1e0::6301:fa4d";
        };
      };
      cicero = {
        system = "x86_64-linux";
        tailscale = {
          v4 = "100.72.52.108";
          v6 = "fd7a:115c:a1e0::2801:3495";
        };
      };
      praeconinus = {
        system = "aarch64-linux";
        tailscale = {
          v4 = "100.111.235.57";
          v6 = "fd7a:115c:a1e0::b33a:eb39";
        };
      };
      nixos = {
        system = "x86_64-linux";
        tailscale = {
          v4 = "100.99.178.23";
          v6 = "fd7a:115c:a1e0::b01:b217";
        };
      };
      mini = {
        system = "aarch64-darwin";
        tailscale = {
          v4 = "100.111.29.21";
          v6 = "fd7a:115c:a1e0::db01:1d31";
        };
      };
      aedilis = {
        system = "x86_64-linux";
        tailscale = {
          v4 = "100.108.78.46";
          v6 = "fd7a:115c:a1e0::b43a:4e2f";
        };
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
