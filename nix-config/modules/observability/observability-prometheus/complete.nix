# prometheus — aggregator. Importing this (as `nixos.prometheus`) realizes the runtime and
# registers the prometheus (server vhost) + prometheus-client (client cert) catalog entries.
{ inputs, ... }:
{
  flake.modules.nixos.prometheus = {
    imports = with inputs.self.modules.nixos; [
      prometheus-catalog
      prometheus-service
    ];
  };
}
