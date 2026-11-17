{
  # All secret declarations live in the modules that consume them:
  #   modules/identity/identity-step-ca/secrets/cicero.yaml — yk_pin,
  #     intermediate_crt_password + the yk-pin.txt template
  #   modules/homelab/homelab-ssh-cert-renewer/secrets/cicero.yaml —
  #     step_jwk_provisioner_password
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
