{
  inputs,
  lib,
  config,
  pkgs,
  ...
}:
{
  # done
  security.sudo.execWheelOnly = true;

  # done
  security.rtkit.enable = true;

  # done
  security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];

  # done
  services.pcscd.enable = true;

  networking.firewall = {
    enable = true;

    # TODO: Move to features/systems/nixos/security.nix
    allowedTCPPorts = [
      10300 # Remove
      10200 # Remove
      49545
      58042
      56503
    ];

    allowedUDPPorts = [
      5353
      49545
      58042
      56503
    ];

    interfaces = {
      tailscale0 = {
        allowedTCPPorts = [
          22
          5252
          # Caddy ACME HTTP-01: the internal step-ca (cicero) validates the
          # opencode vhost's managed cert over the tailnet (mirrors cicero's
          # tailscale0-only :80). Never opened on the LAN/public interfaces.
          80
          # NOTE: 443 (the opencode mTLS vhost) is emitted by the
          # homelab-service-firewall generator from the opencode catalog entry
          # (access.scope.tailnet) — deliberately tailscale0-only.
        ];
        allowedUDPPorts = [ 5252 ];
      };
    };
  };

  # done
  services.openssh = {
    openFirewall = false;
    settings = {
      PermitRootLogin = "no";
      X11Forwarding = false;
    };
  };

  # done
  programs.ssh = {
    startAgent = true;
    enableAskPassword = true;
  };

  # TODO: add to features/systems/nixos/ssh-certs.nix
  services.ssh-cert-renewer = {
    sshKeyName = "ssh_host_ed25519_key";
    enable = true;
    serviceName = "nixos.plato-splunk.media";
    passwordFile = config.sops.secrets.step_jwk_provisioner_password.path;
  };
}
