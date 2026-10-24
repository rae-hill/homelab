{ inputs, lib, config, pkgs, ... }:
{
  security.sudo.execWheelOnly = true;

  security.pki.certificateFiles = [ (inputs.self + "/certs/alford-root.crt") ];

  services.pcscd.enable = true;

  security.polkit.extraConfig = ''
    polkit.addRule(function(action, subject) {
      if (action.id == "org.debian.pcsc-lite.access_card") {
        return polkit.Result.YES;
      }
    });

    polkit.addRule(function(action, subject) {
      if (action.id == "org.debian.pcsc-lite.access_pcsc") {
        return polkit.Result.YES;
      }
    });
  '';

  networking.firewall = {
    enable = true;

    interfaces = {
      tailscale0 = {
        allowedTCPPorts = [
          22
          80
          443
          5252
          # NOTE: 8443 (Caddy https for the cicero-metrics / ca-monitoring mTLS vhosts) is
          # now emitted by the homelab-service-firewall generator from those catalog entries
          # (scope.tailnet, listenPort 8443). 443 here is step-ca's (not a Caddy vhost);
          # 80 is the Caddy :80 challenge front — both stay baseline.
        ];
      };
    };
  };

  services.openssh.openFirewall = true;

  services.ssh-cert-renewer = {
    sshKeyName = "ssh_host_ed25519_key";
    enable = true;
    serviceName = "cicero.plato-splunk.media";
    passwordFile = config.sops.secrets.step_jwk_provisioner_password.path;
  };
}
