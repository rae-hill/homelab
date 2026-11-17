{
  # All secret declarations live in the modules that consume them:
  #   system-configs/nixos/secrets/smb.yaml     — host-nixos-filesystems
  #   modules/ai/ai-opencode/secrets/nixos.yaml — opencode providers (HM)
  #   modules/homelab/homelab-ssh-cert-renewer/secrets/nixos.yaml —
  #     step_jwk_provisioner_password
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
