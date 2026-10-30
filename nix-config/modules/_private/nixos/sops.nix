{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  sops.defaultSopsFile = inputs.self + "/nix-config/secrets/nixos.yaml";
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";

  sops.secrets.smb_passphrase = {
    owner = "root";
  };

  sops.secrets.jacob_smb_passphrase = {
    owner = "root";
  };

  sops.templates."smb-creds" = {
    content = ''
      username=nixos
      password=${config.sops.placeholder.smb_passphrase}
    '';
    owner = "root";
  };

  sops.templates."jacob-smb-creds" = {
    content = ''
      username=jacob-alford
      password=${config.sops.placeholder.jacob_smb_passphrase}
    '';
    owner = "root";
  };

  sops.secrets.step_jwk_provisioner_password = {
    owner = "root";
  };

  sops.secrets.qwen_openai_key = {
    owner = "jacob";
  };
}
