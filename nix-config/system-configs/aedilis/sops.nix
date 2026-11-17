{
  # Secret declarations live in the modules that consume them, each pointing at
  # its per-service file under secrets/aedilis/:
  #   technitium.yaml — system-configs/aedilis/technitium.nix
  #   step-ca.yaml    — homelab-ssh-cert-renewer (step_jwk_provisioner_password)
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/admin/.config/sops/age/keys.txt";
}
