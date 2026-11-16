{ config, inputs, ... }:
let
  c = config.constants;
  svc = c.services.ollama;
in
{
  # NixOS
  flake.modules.nixos.services-ollama = { pkgs, pkgs-unstable }: {
    services.ollama = {
      enable = true;
      acceleration = "cuda";
      package = pkgs-unstable.ollama;

      openFirewall = true;

      host = "0.0.0.0";
      port = svc.port;
    };

    nixpkgs.overlays = [
      (self: super: {
        ctranslate2 = super.ctranslate2.override {
          withCUDA = true;
          withCuDNN = true;
        };
      })
    ];
  };
}
