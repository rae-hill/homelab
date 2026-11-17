{ inputs, config, ... }:
{
  sops.defaultSopsFile = inputs.self + "/nix-config/secrets/praeconinus.yaml";
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";

  sops.secrets.homelab_api_jwk_password = {
    owner = "homelab-api";
    group = "homelab-api";
  };
}
