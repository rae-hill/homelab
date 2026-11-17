{ config, ... }:
let
  c = config.constants;
  svc = c.services.wyoming;
in
{
  flake.modules.nixos.wyoming =
    { ... }:
    {
      services.wyoming = {
        faster-whisper.servers = {
          home = {
            enable = true;
            uri = "tcp://0.0.0.0:${builtins.toString svc.whisperPort}";
            language = "en";
            device = "cuda";
            model = "distil-large-v3";
          };
        };

        piper = {
          servers.home = {
            enable = true;
            voice = "en_GB-southern_english_female-low";
            uri = "tcp://0.0.0.0:${builtins.toString svc.piperPort}";
          };
        };
      };
    };
}
