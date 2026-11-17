{
  # Secret declarations live in the modules that consume them, each pointing at
  # its per-service file under secrets/nixos/:
  #   smb.yaml      — host-nixos-filesystems (smb_passphrase,
  #                   jacob_smb_passphrase + the creds templates)
  #   step-ca.yaml  — homelab-ssh-cert-renewer (step_jwk_provisioner_password)
  #   opencode.yaml — home-manager (rae-sops / jacob-nixos → opencode providers)
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
