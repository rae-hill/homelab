{ inputs, ... }:
{
  flake.modules.nixos.opencode-providers = {
    imports = with inputs.self.modules.nixos; [
      opencode-providers-alibaba
    ];
  };
}
