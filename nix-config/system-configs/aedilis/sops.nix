{
  # All secret declarations live in the modules that consume them:
  #   system-configs/aedilis/secrets/technitium.yaml — aedilis/technitium.nix
  #   modules/homelab/homelab-ssh-cert-renewer/secrets/aedilis.yaml —
  #     step_jwk_provisioner_password
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/admin/.config/sops/age/keys.txt";
}
