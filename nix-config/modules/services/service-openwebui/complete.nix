# openwebui — feature aggregate. Preserves the `nixos.openwebui` import name.
{ inputs, ... }:
{
  flake.modules.nixos.openwebui = {
    imports = with inputs.self.modules.nixos; [
      openwebui-catalog
      openwebui-service
    ];
  };
}
