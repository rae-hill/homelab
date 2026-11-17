{
  # Secret declarations live in the modules that consume them:
  #   system-configs/nixos/secrets/smb.yaml    — host-nixos-filesystems
  #   modules/ai/ai-opencode/secrets/nixos.yaml — opencode providers (HM)
  # Transitional (multi-consumer, pending Phase 1b of
  # docs/secretspec-migration-plan.md):
  #   secrets/nixos/step-ca.yaml — homelab-ssh-cert-renewer
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
