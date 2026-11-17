{ inputs, lib, config, pkgs, ... }:
{
  sops.defaultSopsFile = inputs.self + "/nix-config/secrets/mini.yaml";
  sops.defaultSopsFormat = "yaml";

  sops.age.sshKeyPaths = [ "/etc/ssh/ssh_host_ed25519_key" ];

  sops.age.keyFile = "Users/jacob/Library/Application\ Support/sops/age/keys.txt";
  sops.age.generateKey = true;
}
