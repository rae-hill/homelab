{
  # Secret declarations live in the modules that consume them:
  #   secrets/praeconinus/homelab-api.yaml — homelab-api/systemd-service.nix
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
