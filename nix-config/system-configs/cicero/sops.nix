{
  # Secret declarations live in the service modules that consume them, each
  # pointing at its per-service file under secrets/cicero/:
  #   step-ca.yaml — identity-step-ca.nix (yk_pin, intermediate_crt_password +
  #                  yk-pin.txt template) and homelab-ssh-cert-renewer.nix
  #                  (step_jwk_provisioner_password).
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
