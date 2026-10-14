{ inputs, config, ... }:
{
  sops.defaultSopsFile = inputs.self + "/nix-config/secrets/aedilis.yaml";
  sops.age.keyFile = "/home/admin/.config/sops/age/keys.txt";

  # Technitium web console admin password (bootstrap on first start). Owner-only
  # (mode 0400); only the technitium service user reads these — no group needed.
  sops.secrets.technitium_admin_password = {
    owner = "technitium";
  };

  # OIDC/SSO client secret for the Kanidm-registered "technitium" client.
  sops.secrets.technitium_sso_client_secret = {
    owner = "technitium";
  };

  # Password for the PKCS#12 bundle used by the DoT/DoQ/DoH listener.
  sops.secrets.technitium_pkcs12_password = {
    owner = "technitium";
  };

  # Credentials for the limited "prometheus" metrics user. The metrics user is
  # created MANUALLY (see runbook) — this is the password you set when creating it,
  # also consumed by augustus to compute scrape logins. The TOTP seed is NOT here:
  # you capture it when enabling 2FA on the metrics user and transfer it to augustus
  # out-of-band. See docs/aedilis-deployment-runbook.md §7.
  sops.secrets.technitium_metrics_user_password = {
    owner = "technitium";
  };

  # Password for the dedicated, least-privilege "provisioner" API user that the
  # token broker logs in as (Settings:Modify + Zones:Modify only — NOT admin). The
  # provisioner user is created MANUALLY against the admin account; see the runbook.
  # Owner-only: only the broker service user (technitium) reads it.
  sops.secrets.technitium_provisioner_password = {
    owner = "technitium";
  };

  # Password for the step-ca JWK provisioner, used by ssh-cert-renewer to obtain
  # the host's SSH certificate (see _private/aedilis/security.nix).
  sops.secrets.step_jwk_provisioner_password = {
    owner = "root";
  };
}
