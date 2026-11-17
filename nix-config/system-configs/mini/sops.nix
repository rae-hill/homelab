{
  # Secret declarations live in the modules that consume them:
  #   modules/ai/ai-openclaw/secrets/mini.yaml — ai-openclaw/service.nix
  # Only the age identity stays host-local.
  sops.defaultSopsFormat = "yaml";
  sops.age.sshKeyPaths = [ "/etc/ssh/ssh_host_ed25519_key" ];
  sops.age.keyFile = "Users/jacob/Library/Application\ Support/sops/age/keys.txt";
  sops.age.generateKey = true;
}
