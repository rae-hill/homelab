{ inputs, ... }:
{
  flake.modules.nixos.acme-client-cert = {
    imports = with inputs.self.modules.nixos; [
      acme-client-cert-options
    ];
  };

  flake.modules.darwin.acme-client-cert = {
    imports = with inputs.self.modules.darwin; [
      acme-client-cert-options
    ];
  };
}
