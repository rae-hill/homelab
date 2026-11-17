{ inputs, ... }:
{
  flake.modules.homeManager.opencode-providers = {
    imports = with inputs.self.modules.homeManager; [
      opencode-providers-alibaba
      opencode-providers-openrouter
    ];
  };
}
