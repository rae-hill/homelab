{
  config,
  inputs,
  lib,
  ...
}:
let
  opencodeSvc = config.constants.services.opencode;
in
{
  flake.modules.homeManager.opencode-web =
    { ... }:
    {
      programs.opencode.web = {
        enable = true;
        extraArgs = [
          "--hostname"
          "127.0.0.1"
          "--port"
          (lib.toString opencodeSvc.port)
          "--service"
        ];
      };
    };
}
