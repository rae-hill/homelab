{ inputs, config, ... }:
{
  sops.defaultSopsFile = inputs.self + "/nix-config/secrets/aedilis.yaml";
  sops.age.keyFile = "/home/admin/.config/sops/age/keys.txt";

  # Technitium web console admin password (bootstrap on first start).
  sops.secrets.technitium_admin_password = {
    owner = "technitium";
    group = "technitium";
  };

  # OIDC/SSO client secret for the Kanidm-registered "technitium" client.
  sops.secrets.technitium_sso_client_secret = {
    owner = "technitium";
    group = "technitium";
  };

  # Password for the PKCS#12 bundle used by the DoT/DoQ listener.
  sops.secrets.technitium_pkcs12_password = {
    owner = "technitium";
    group = "technitium";
  };

  # Credentials for the limited "prometheus" metrics user (used to bootstrap the
  # user + TOTP on first provisioning; augustus performs the actual logins).
  sops.secrets.technitium_metrics_user_password = {
    owner = "technitium";
    group = "technitium";
  };

  sops.secrets.technitium_metrics_totp_secret = {
    owner = "technitium";
    group = "technitium";
  };

  # Password for the step-ca JWK provisioner, used by ssh-cert-renewer to obtain
  # the host's SSH certificate (see _private/aedilis/security.nix).
  sops.secrets.step_jwk_provisioner_password = {
    owner = "root";
  };
}
