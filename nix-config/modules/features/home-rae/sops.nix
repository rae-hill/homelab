{ inputs, ... }:
{
  flake.modules.homeManager.rae-sops =
    { inputs, ... }:
    {
      sops = {
        defaultSopsFile = inputs.self + "/nix-config/secrets/nixos.yaml";
        age.keyFile = "/home/rae/.config/sops/age/keys.txt";

        secrets.qwen_openai_key = { };
      };
    };
}
