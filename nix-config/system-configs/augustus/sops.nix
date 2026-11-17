{
  # Secret declarations live in the service/host modules that consume them.
  # Single-consumer files are module-local (moved out of secrets/augustus/):
  #   modules/identity/identity-kanidm/secrets/augustus.yaml
  #   modules/ai/ai-openwebui/secrets/augustus.yaml
  #   modules/apps/apps-home-assistant/secrets/augustus.yaml
  #   modules/apps/apps-planka/secrets/augustus.yaml
  #   modules/apps/apps-habitsync/secrets/augustus.yaml
  #   modules/apps/apps-minecraft/secrets/augustus.yaml
  #   modules/networking/networking-radius/secrets/augustus.yaml
  #   modules/networking/networking-unpoller/secrets/augustus.yaml
  #   modules/observability/observability-grafana/secrets/augustus.yaml
  #   system-configs/augustus/secrets/{failure-notifs,smb,postgres}.yaml
  # Still transitional under secrets/augustus/ — multi-consumer files pending
  # the split in docs/secretspec-migration-plan.md Phase 1b:
  #   homelab-api.yaml, step-ca.yaml, technitium.yaml
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
