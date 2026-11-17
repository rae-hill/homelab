{ inputs, ... }:
{
  flake.modules.homeManager.rae-sops =
    { inputs, ... }:
    {
      # Secret declarations live in the modules that consume them (e.g. the
      # opencode provider modules declare their keys from
      # modules/ai/ai-opencode/secrets/nixos.yaml with an explicit sopsFile). Only the age
      # identity stays home-local.
      sops.age.keyFile = "/home/rae/.config/sops/age/keys.txt";
    };
}
