{ inputs, lib, config, pkgs, ... }:
{
  sops.defaultSopsFile = inputs.self + "/nix-config/secrets/cicero.yaml";
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";

  sops.secrets.intermediate_crt_password = {
    owner = "step-ca";
    group = "step-ca";
  };

  sops.secrets.yk_pin = {
    owner = "step-ca";
    group = "step-ca";
  };

  sops.templates."yk-pin.txt" = {
    content = config.sops.placeholder.yk_pin;
    owner = "step-ca";
    group = "step-ca";
  };

  sops.secrets.step_jwk_provisioner_password = {
    owner = "root";
  };
}
