{ inputs, config, ... }:
let
  c = config.constants;
  svc = c.services.step-ca;

  dbClientCert = "/var/lib/step-ca/certs/db-client.crt";
  dbClientKey = "/var/lib/step-ca/certs/db-client.key";
in
{
  flake.modules.nixos.step-ca =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.step-ca = {
        enable = true;
        address = "0.0.0.0";
        port = svc.port;
        openFirewall = false;
        intermediatePasswordFile = config.sops.secrets.intermediate_crt_password.path;

        settings = {
          root = c.ca.rootCert;
          crt = c.ca.intermediateCert;
          key = "yubikey:slot-id=9c";

          metricsAddress = "127.0.0.1:${builtins.toString c.ca.metricsPortInternal}";

          insecureAddress = "";

          dnsNames = [ svc.domain ];

          kms = {
            type = "yubikey";
            uri = "yubikey:pin-source=${config.sops.templates."yk-pin.txt".path}";
          };

          logger = {
            format = "json";
          };

          db = {
            type = "badgerv2";
            dataSource = "/var/lib/step-ca/db";
          };

          ssh = {
            hostKey = "yubikey:slot-id=82";
            userKey = "yubikey:slot-id=83";
          };

          authority = {
            policy = {
              x509 = {
                allow = {
                  dns = [ "*.${c.baseDomain}" ] ++ c.x509PermittedCommonNames;
                  commonNames = c.x509PermittedCommonNames;
                  email = [ "@${c.baseDomain}" ];
                  ip = c.x509PermittedIps;
                };
                deny = {
                  dns = [
                    "postgres.${c.baseDomain}"
                    "root.${c.baseDomain}"
                  ];
                  email = [
                    "postgres@${c.baseDomain}"
                    "root@${c.baseDomain}"
                  ];
                };
                allowWildcardNames = false;
              };
              ssh = {
                host = {
                  allow = {
                    dns = [ "*.${c.baseDomain}" ];
                  };
                  deny = {
                    dns = [
                      "postgres.${c.baseDomain}"
                      "root.${c.baseDomain}"
                    ];
                  };
                };
                user = {
                  allow = {
                    principal = [ "*" ];
                    email = [ "@${c.baseDomain}" ];
                  };
                  deny = {
                    principal = [
                      "postgres"
                      "root"
                    ];
                    email = [
                      "postgres@${c.baseDomain}"
                      "root@${c.baseDomain}"
                    ];
                  };
                };
              };
            };
            provisioners = [
              {
                type = "ACME";
                name = "http";
                forceCN = true;
                challenges = [
                  "http-01"
                ];
                claims = {
                  "maxTLSCertDuration" = "73h";
                  "defaultTLSCertDuration" = "48h";
                };
              }
              {
                type = "ACME";
                name = "eap";
                forceCN = true;
                claims = {
                  "maxTLSCertDuration" = "729h";
                  "defaultTLSCertDuration" = "480h";
                };
                challenges = [
                  "device-attest-01"
                ];
                attestationFormats = [
                  "apple"
                  "step"
                ];
                options = {
                  x509 = {
                    template = ''
                      {
                        "subject": {
                          "commonName": {{ toJson .Insecure.CR.Subject.CommonName }}
                        },
                        "sans": {{ toJson (append .SANs (dict "type" "dn" "value" (toJson (dict "commonName" (.Insecure.CR.Subject.CommonName | lower))))) }},
                        "keyUsage": ["digitalSignature"],
                        "extKeyUsage": ["clientAuth"]
                      }
                    '';
                  };
                };
              }
              {
                type = "SSHPOP";
                name = "sshpop";
                claims = {
                  enableSSHCA = true;
                };
              }
              {
                type = "OIDC";
                name = "kanidm";
                clientID = svc.clientId;
                clientSecret = "Fb6vJKX4DcxFxRY4DpFJtkAtXv9fGH2rkewYBJmJWmK8xq6PLT4xyHHaQzmxksGLjH9rGWsJarEeGo4nRbQGNkmfJQpvnrjW38bM";
                listenAddress = "127.0.0.1:10000";
                configurationEndpoint = c.idm.mkOidcEndpoint svc.clientId;
                domains = [ c.baseDomain ];
                claims = {
                  enableSSHCA = true;
                  defaultUserSSHCertDuration = "2h";
                };
              }
              {
                type = "JWK";
                name = "augustus.${c.baseDomain}";
                key = {
                  "use" = "sig";
                  "kty" = "EC";
                  "kid" = "7_wfaqwbLk94as2f7jKmvXs3yr51bDgLLdXgLRX_pu4";
                  "crv" = "P-256";
                  "alg" = "ES256";
                  "x" = "W4yiQ8BzNA76ehZeIK3cmHY4BlsoTHLdTrpR3-qBQ3E";
                  "y" = "vCnEkPmAyxHGOJPDc2hC-YqeDlF1rFwFpmW_efYaMSs";
                };
                claims = {
                  enableSSHCA = true;
                };
              }
              {
                type = "JWK";
                name = "cicero.${c.baseDomain}";
                key = {
                  "use" = "sig";
                  "kty" = "EC";
                  "kid" = "v3TMvBAmYNVhlOXOEIKOVLrEXqaPFPmoTsWVAWZNUuI";
                  "crv" = "P-256";
                  "alg" = "ES256";
                  "x" = "TNcsQAP1zbr6sFxG6SQMCn8vi10Ejm5VeYiFC90fhEM";
                  "y" = "Nh7W4ufWYjyE7tQx8vxbYFVGiVQyDtFHMwTJuA94cB0";
                };
                claims = {
                  enableSSHCA = true;
                };
              }
              {
                type = "JWK";
                name = "nixos.${c.baseDomain}";
                key = {
                  "use" = "sig";
                  "kty" = "EC";
                  "kid" = "a0gFjUpg-3LbloOKHC0KqxfAcTnyr8yV-b0gXb2QLDo";
                  "crv" = "P-256";
                  "alg" = "ES256";
                  "x" = "bHB9No_-BM7vng2OasKbaV5vaF0owAnx5fCEee94dhc";
                  "y" = "hI4jchAOkIl4AnaZWBZ8jOAxc-9ul4HkJPwmr6Qj-Pk";
                };
                claims = {
                  enableSSHCA = true;
                };
              }
            ];
            template = { };
            backdate = "1m0s";
          };

          tls = {
            cipherSuites = [
              "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256"
              "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256"
            ];
            minVersion = 1.2;
            maxVersion = 1.3;
            renegotiation = false;
          };

          commonName = "Step Online CA";
        };
      };

      systemd.services.step-ca = {
        environment = {
          STEPPATH = "/var/lib/step-ca";
          PGSSLCERT = dbClientCert;
          PGSSLKEY = dbClientKey;
          PGSSLROOTCERT = toString c.ca.rootCert;
          PGSSLMODE = "verify-full";
        };
      };
    };
}
