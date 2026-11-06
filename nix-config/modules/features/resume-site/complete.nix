{ inputs, ... }:
{
  flake.modules.nixos.resume-site = {
    imports = with inputs.self.modules.nixos; [
      resume-site-caddy
    ];
  };
}
