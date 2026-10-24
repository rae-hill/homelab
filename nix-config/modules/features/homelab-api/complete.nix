{ inputs, ... }:
{
  flake.modules.nixos.homelab-api = {
    imports = with inputs.self.modules.nixos; [
      homelab-secret-provisioner
      homelab-api-service
      homelab-api-catalog
      homelab-api-oidc
    ];
  };
}
