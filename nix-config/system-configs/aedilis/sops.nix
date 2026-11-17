{
  # Secret declarations live in the modules that consume them:
  #   system-configs/aedilis/secrets/technitium.yaml — aedilis/technitium.nix
  # Transitional (multi-consumer, pending Phase 1b of
  # docs/secretspec-migration-plan.md):
  #   secrets/aedilis/step-ca.yaml — homelab-ssh-cert-renewer
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/admin/.config/sops/age/keys.txt";
}
