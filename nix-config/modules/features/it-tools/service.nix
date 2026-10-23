# it-tools — runtime (container + failure-notifs).
#
# Everything service-specific that is NOT the networking contract stays here. failure-notifs
# is tied to the systemd unit this defines, so it lives with the service (never the catalog).
{ config, ... }:
let
  svc = config.constants.services.it-tools;
in
{
  flake.modules.nixos.it-tools-service =
    { ... }:
    {
      virtualisation.oci-containers.containers = {
        it-tools = {
          image = "sharevb/it-tools:latest";
          ports = [ "127.0.0.1:${builtins.toString svc.port}:8080" ];
        };
      };

      services.failure-notifs.attachServices = [
        "podman-it-tools"
      ];
    };
}
