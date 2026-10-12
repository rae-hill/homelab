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

  # Credentials for the limited "prometheus" metrics user. The TOTP seed is NOT
  # here: it is server-generated on first provisioning and persisted to a state
  # file (/var/lib/technitium-dns-server/metrics-totp-seed) for out-of-band
  # transfer to augustus. See docs/aedilis-deployment-runbook.md §7.
  sops.secrets.technitium_metrics_user_password = {
    owner = "technitium";
  };

  # Password for the step-ca JWK provisioner, used by ssh-cert-renewer to obtain
  # the host's SSH certificate (see _private/aedilis/security.nix).
  sops.secrets.step_jwk_provisioner_password = {
    owner = "root";
  };
}
