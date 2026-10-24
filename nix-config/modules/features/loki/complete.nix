# loki — aggregator. Importing this (as `nixos.loki`) both realizes the loki runtime and
# registers the loki-push catalog entry; augustus's generators pick up the vhost.
{ inputs, ... }:
{
  flake.modules.nixos.loki = {
    imports = with inputs.self.modules.nixos; [
      loki-catalog
      loki-service
    ];
  };
}
