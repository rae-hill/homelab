{ inputs, config, ... }:
let
  c = config.constants;
  svc = c.services.radius;
  containerName = "radiusd";
in
{
  flake.modules.nixos.radius-service =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      caCert = config.environment.etc."ssl/certs/ca-certificates.crt".source;
      radiusCaDir = pkgs.runCommand "radius-ca-dir" { } ''
        mkdir -p $out
        cp ${inputs.self + "/certs/alford-root.crt"} $out/root.pem
        cp ${inputs.self + "/certs/intermediate_ca_2.crt"} $out/intermediate.pem
        ${pkgs.openssl}/bin/openssl rehash $out
      '';
      inherit (config.security.acme.certs."${svc.domain}") directory;
    in
    {
      virtualisation.oci-containers.containers."${containerName}" = {
        user = "root";
        image = "kanidm/radius:latest";
        ports = [
          "0.0.0.0:1812:1812"
          "0.0.0.0:1812:1812/udp"
          "0.0.0.0:1813:1813"
          "0.0.0.0:1813:1813/udp"
        ];
        environment = {
          RADIUS_USER = "222:222";
          DEBUG = "True";
          REQUESTS_CA_BUNDLE = "/data/ca.pem";
        };
        volumes = [
          "${caCert}:/etc/pki/ca-trust/source/anchors"
          "${caCert}:/data/ca.pem"
          "${radiusCaDir}:/data/radius-ca:ro"
          "${directory}/fullchain.pem:/data/cert.pem"
          "${directory}/key.pem:/data/key.pem"
          "${config.sops.templates."radius_config".path}:/data/radius.toml:Z"
        ];
      };

      # ACME cert + http://radius challenge vhost now generated from the catalog
      # (features/radius/catalog.nix). The container still reads the cert dir via the
      # `inherit (config.security.acme.certs."${svc.domain}") directory;` binding above —
      # the generator creates the same cert name, so the directory path is unchanged.

      sops.templates."radius_config" = {
        owner = "radiusd";
        content = ''
          uri = "${c.idm.url}"
          verify_hostnames = true
          verify_ca = true
          ca_path = "/data/ca.pem"

          auth_token = "${config.sops.placeholder.ui_radius_auth_token}"

          radius_default_vlan = 45

          radius_required_groups = ["radius.access@${c.idm.domain}"]

          radius_groups = [
            { spn = "radius.access_guest@${c.idm.domain}", vlan = 45 },
            { spn = "radius.access_home@${c.idm.domain}", vlan = 55 },
            { spn = "radius.access_private@${c.idm.domain}", vlan = 100 },
            { spn = "radius.access_servers@${c.idm.domain}", vlan = 100 },
            { spn = "radius.access_admin@${c.idm.domain}", vlan = 150 }
          ]

          radius_clients = [
            { name = "u6e", ipaddr = "10.10.0.122", secret = "${config.sops.placeholder.unifi_radius_secret}" },
            { name = "udmp", ipaddr = "10.10.0.1", secret = "${config.sops.placeholder.unifi_radius_secret}" }
            { name = "uswa", ipaddr = "10.10.0.214", secret = "${config.sops.placeholder.unifi_radius_secret}" }
            { name = "uspm", ipaddr = "10.10.0.114", secret = "${config.sops.placeholder.unifi_radius_secret}" }
            { name = "uswf", ipaddr = "10.10.0.233", secret = "${config.sops.placeholder.unifi_radius_secret}" }
          ]

          radius_cert_path = "/data/cert.pem"
          radius_key_path = "/data/key.pem"
          radius_ca_dir = "/data/radius-ca"
        '';
      };

      services.failure-notifs.attachServices = [
        "podman-radiusd"
      ];
    };
}
