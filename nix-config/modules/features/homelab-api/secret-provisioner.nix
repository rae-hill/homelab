{ ... }:
{
  flake.modules.nixos.homelab-secret-provisioner =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.homelab-secret-provisioner;

      stateDir = "homelab-api";
      stateAbsDir = "/var/lib/${stateDir}";
      jwkPub = "${stateAbsDir}/jwk.pub.json";
      jwkPriv = "${stateAbsDir}/jwk.priv.json";
      apiKeysOut = "${stateAbsDir}/api-keys.json";
      hmacSecretOut = "${stateAbsDir}/hmac.secret";

      apiKeysTemplate = pkgs.writeText "api-keys-template.json" (
        builtins.toJSON (lib.attrValues cfg.apiKeys)
      );

      provisioner = pkgs.writeShellApplication {
        name = "homelab-secret-provisioner";
        runtimeInputs = with pkgs; [
          step-cli
          jq
          coreutils
        ];
        text = ''
          set -euo pipefail
          umask 077

          state_dir=${stateAbsDir}
          jwk_pub=${jwkPub}
          jwk_priv=${jwkPriv}
          api_keys_src=${apiKeysTemplate}
          api_keys_out=${apiKeysOut}
          hmac_out=${hmacSecretOut}
          jwk_password_file=${cfg.privateKeyPasswordFile}

          provision_jwks() {
            if [[ -f "$jwk_pub" && -f "$jwk_priv" ]]; then
              return 0
            fi

            # step refuses to overwrite, so clear any half-written remnant
            # from a previous failed run.
            rm -f "$jwk_pub" "$jwk_priv"

            step crypto jwk create "$jwk_pub" "$jwk_priv" \
              --use sig --kty OKP --crv Ed25519 \
              --password-file "$jwk_password_file"
          }

          provision_hmac_secret() {
            if [[ -f "$hmac_out" ]]; then
              return 0
            fi

            # 64 raw bytes of entropy, base64-encoded, no trailing newline.
            head -c 64 /dev/urandom | base64 -w0 > "$hmac_out"
            chmod 0600 "$hmac_out"
          }

          provision_api_keys() {
            # Build {path: contents} for each distinct apiKeyFile referenced
            # in the Nix-emitted template.
            local keymap
            keymap=$(
              jq -r '.[].apiKeyFile' "$api_keys_src" | sort -u | while IFS= read -r f; do
                jq -Rn --arg p "$f" --rawfile c "$f" \
                  '{($p): ($c | rtrimstr("\n"))}'
              done | jq -s 'add // {}'
            )

            local tmp
            tmp=$(mktemp -p "$state_dir")
            jq --argjson keys "$keymap" '
              map({ apiKey: $keys[.apiKeyFile], email, permissions })
            ' "$api_keys_src" > "$tmp"
            chmod 0600 "$tmp"
            mv "$tmp" "$api_keys_out"
          }

          provision_jwks
          provision_hmac_secret
          provision_api_keys
        '';
      };
    in
    {
      options.services.homelab-secret-provisioner = {
        enable = lib.mkEnableOption "homelab secret provisioner";

        privateKeyPasswordFile = lib.mkOption {
          type = lib.types.str; # str, not path — see notes
          description = ''
            Path (at runtime) to a file containing the password used to
            encrypt the generated JWK private key.
          '';
        };

        apiKeys = lib.mkOption {
          default = { };
          description = "API key entries to render into api-keys.json.";
          type = lib.types.attrsOf (
            lib.types.submodule {
              options = {
                apiKeyFile = lib.mkOption {
                  type = lib.types.str;
                  description = "Runtime path to the file holding this API key.";
                };
                email = lib.mkOption {
                  type = lib.types.str;
                  description = "Email associated with this API key.";
                };
                permissions = lib.mkOption {
                  type = lib.types.nonEmptyListOf (
                    lib.types.enum [
                      "Config_Wifi"
                      "Config_Certs"
                      "Cert_Root"
                      "Cert_Intermediate"
                      "Cert_Combined"
                      "Status_Health"
                      "Status_Self"
                      "OAuth_Token"
                      "OAuth_ClaimCheck"
                      "Resume_Print"
                      "Resume_Tailor"
                    ]
                  );
                  description = "Permissions granted to this key.";
                };
              };
            }
          );
        };

        user = lib.mkOption {
          type = lib.types.str;
          default = "homelab-api";
        };
        group = lib.mkOption {
          type = lib.types.str;
          default = "homelab-api";
        };
      };

      config = lib.mkIf cfg.enable {
        systemd.services.homelab-secret-provisioner = {
          description = "Provision homelab JWKs, API keys file, and HMAC secret";
          wantedBy = [ "multi-user.target" ];
          serviceConfig = {
            Type = "oneshot";
            RemainAfterExit = true;
            User = cfg.user;
            Group = cfg.group;
            StateDirectory = stateDir;
            StateDirectoryMode = "0700";
            UMask = "0077";
            ExecStart = lib.getExe provisioner;
          };
        };
      };
    };
}
