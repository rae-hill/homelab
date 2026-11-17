{
  # Secret declarations live in the service/host modules that consume them,
  # each pointing at its per-service file under secrets/augustus/:
  #   kanidm.yaml          — identity-kanidm/service.nix
  #   openwebui.yaml       — ai-openwebui (service + catalog)
  #   home-assistant.yaml  — apps-home-assistant (service + catalog)
  #   radius.yaml          — networking-radius/service.nix
  #   planka.yaml          — apps-planka (service + catalog)
  #   habitsync.yaml       — apps-habitsync/service.nix
  #   minecraft.yaml       — apps-minecraft.nix
  #   homelab-api.yaml     — homelab-api/systemd-service.nix + host-augustus-programs
  #   postgres.yaml        — host-augustus-programs (restic backup job)
  #   step-ca.yaml         — host-augustus-programs + homelab-ssh-cert-renewer
  #   failure-notifs.yaml  — host-augustus-system (pushover)
  #   grafana.yaml         — observability-grafana (service + catalog)
  #   unpoller.yaml        — networking-unpoller.nix
  #   technitium.yaml      — networking-technitium/kanidm.nix + observability-prometheus
  #   smb.yaml             — host-augustus-filesystems
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
