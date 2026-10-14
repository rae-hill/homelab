{ ... }:
{
  # Option schema for the API-driven Technitium provisioning feature. These used to
  # live inside the generic `technitium` feature's options.nix; they are extracted
  # here so the generic server module (`technitium`) is server-only and provisioning
  # is a separate, opt-in feature. The namespace is unchanged
  # (services.technitium-server-complete.provision.*) so a host sets one config
  # surface regardless of how the modules are split.
  flake.modules.nixos.technitium-provisioning-options =
    { lib, ... }:
    let
      inherit (lib) mkOption mkEnableOption types;

      # Fields common to every record type.
      commonRecordOptions = {
        name = mkOption {
          type = types.str;
          example = "augustus.home.plato-splunk.media";
          description = ''
            Record owner name. Use "@" or "" for the zone apex; any other value is
            treated as an FQDN and passed through as the `domain` API parameter.
          '';
        };

        ttl = mkOption {
          type = types.nullOr types.int;
          default = null;
          description = "Record TTL in seconds. Null uses the server default.";
        };
      };

      # Helper: a submodule for one record type, with the common fields plus the
      # type-specific fields. Type-specific fields have NO default, so the module
      # system enforces them at eval time — this removes the need for runtime
      # validation in the provisioning script.
      mkRecord = specificOptions: types.submodule { options = commonRecordOptions // specificOptions; };

      # A DNS record is a tagged union (attrTag): the attribute key IS the record
      # type discriminator, and each tag carries exactly the fields that type
      # requires. e.g. `{ A = { name = "@"; address = "100.64.0.1"; }; }`.
      #
      # Benefits over a flat record with nullable fields:
      #   - Each type's required fields are structurally required (no runtime check).
      #   - Invalid combinations (e.g. an A record with an `exchange`) are rejected
      #     at eval time rather than silently ignored.
      recordType = types.attrTag {
        A = mkOption {
          description = "IPv4 address (A) record.";
          type = mkRecord {
            address = mkOption {
              type = types.str;
              example = "100.64.0.1";
              description = "IPv4 address.";
            };
          };
        };

        AAAA = mkOption {
          description = "IPv6 address (AAAA) record.";
          type = mkRecord {
            address = mkOption {
              type = types.str;
              example = "fd7a:115c:a1e0::1";
              description = "IPv6 address.";
            };
          };
        };

        CNAME = mkOption {
          description = "Canonical name (CNAME) record.";
          type = mkRecord {
            cname = mkOption {
              type = types.str;
              description = "Canonical name the alias points to.";
            };
          };
        };

        TXT = mkOption {
          description = "Text (TXT) record.";
          type = mkRecord {
            text = mkOption {
              type = types.str;
              description = "Text data.";
            };
          };
        };

        MX = mkOption {
          description = "Mail exchange (MX) record.";
          type = mkRecord {
            exchange = mkOption {
              type = types.str;
              description = "Mail exchange host.";
            };
            preference = mkOption {
              type = types.int;
              description = "Preference value (lower = higher priority).";
            };
          };
        };

        NS = mkOption {
          description = "Name server (NS) record.";
          type = mkRecord {
            nameServer = mkOption {
              type = types.str;
              description = "Authoritative name server host.";
            };
          };
        };

        SRV = mkOption {
          description = "Service (SRV) record.";
          type = mkRecord {
            priority = mkOption {
              type = types.int;
              description = "Priority (lower = higher priority).";
            };
            weight = mkOption {
              type = types.int;
              description = "Relative weight among records of the same priority.";
            };
            port = mkOption {
              type = types.int;
              description = "TCP/UDP port of the service.";
            };
            target = mkOption {
              type = types.str;
              description = "Target host providing the service.";
            };
          };
        };

        CAA = mkOption {
          description = "Certification Authority Authorization (CAA) record.";
          type = mkRecord {
            flags = mkOption {
              type = types.int;
              default = 0;
              description = "CAA flags (0 or 128 for the critical bit).";
            };
            tag = mkOption {
              type = types.enum [
                "issue"
                "issuewild"
                "iodef"
              ];
              description = "CAA property tag.";
            };
            value = mkOption {
              type = types.str;
              description = "CAA property value (e.g. a CA domain or mailto URI).";
            };
          };
        };
      };

      zoneType = types.submodule {
        options = {
          type = mkOption {
            type = types.enum [
              "Primary"
              "Forwarder"
            ];
            default = "Primary";
            description = "Authoritative zone type to create when the zone is absent.";
          };

          useSoaSerialDateScheme = mkOption {
            type = types.bool;
            default = true;
            description = "Use the date scheme for the SOA serial when creating the zone.";
          };

          records = mkOption {
            type = types.listOf recordType;
            default = [ ];
            description = "Records to ensure (upsert) in this zone.";
          };
        };
      };
    in
    {
      options.services.technitium-server-complete.provision = {
        enable = mkOption {
          type = types.bool;
          default = true;
          description = "Run the API-driven provisioning units after first start.";
        };

        # Internal: each provisioning unit appends its generated script package here so
        # the flake-level `checks.shellcheck` gate can harvest and build them (which runs
        # their writeShellApplication ShellCheck checkPhase) without building the whole
        # host. Not meant to be set by consumers.
        _lintScripts = mkOption {
          type = types.listOf types.package;
          default = [ ];
          internal = true;
          visible = false;
          description = "Internal registry of provisioning script packages for the shellcheck gate.";
        };

        apiUser = mkOption {
          type = types.str;
          description = ''
            Username of the DEDICATED provisioning account the token broker logs in as.

            This account is NOT created by this module — you create it manually (see the
            runbook). It must be a least-privilege user with only the sections this
            module actually writes:
              - `Settings: Modify`  (DNSSEC validation, QPM rate limits, DoH/DoT/DoQ)
              - `Zones: Modify`     (ensureDnsRecords: create zones + add records)
            Do NOT grant `Administration` — this module no longer manages users/groups.
          '';
          example = "provisioner";
        };

        apiPasswordFile = mkOption {
          type = types.path;
          description = ''
            Path to a file containing the password for `apiUser`. The token broker (and
            only the broker) reads this to mint session tokens. Keep it owner-only
            (sops secret owned by the service user).
          '';
        };

        tokenGroup = mkOption {
          type = types.str;
          default = "technitium-provision";
          description = ''
            Dedicated service-account group allowed to connect to the token broker
            socket. Each provisioning unit joins this group via SupplementaryGroups so
            it can fetch the session token from the socket WITHOUT seeing the apiUser
            password. The socket is root:<tokenGroup> mode 0660; the apiUser password
            and cached token stay readable only by the broker service user.
          '';
        };

        tokenSocketPath = mkOption {
          type = types.str;
          default = "/run/technitium-provision/token.sock";
          description = ''
            Path to the Unix domain socket served by the socket-activated token broker.
            Consumers connect to it (e.g. `socat - UNIX-CONNECT:<path>`) and receive the
            current session token on stdout. Group-locked to tokenGroup.
          '';
        };

        tokenCacheDir = mkOption {
          type = types.str;
          default = "technitium-provision-token";
          description = ''
            StateDirectory name (under /var/lib) where the broker caches the current
            session token and its refresh deadline. Readable only by the broker service
            user — never group-exposed. Consumers never touch this; they use the socket.
          '';
        };

        tokenTtlSeconds = mkOption {
          type = types.int;
          default = 1800;
          description = ''
            How long (seconds) a minted session token is considered fresh before the
            broker refreshes it on the next connection. Must be comfortably under
            Technitium's own session timeout. The broker lazily refreshes on demand when
            this deadline has elapsed (no background timer needed).
          '';
        };

        provisionDoTDoQCert = mkOption {
          type = types.bool;
          default = true;
          description = ''
            Convert the encryptedDns cert to PKCS#12 and enable DoT/DoQ/DoH via the
            Technitium settings API. Only meaningful when encryptedDns.enable is set.
            Requires `apiUser` to hold `Settings: Modify`.
          '';
        };

        certReadyUnits = mkOption {
          type = types.listOf types.str;
          default = [ ];
          example = [ "acme-dns.example.com.service" ];
          description = ''
            Extra systemd units the encrypted-DNS provisioning unit should order
            `after` and `wants` — typically the ACME cert unit(s) that must produce the
            encrypted-DNS cert before the PKCS#12 conversion. Keeps the module
            decoupled from `security.acme` (the consuming layer supplies the exact unit
            names).
          '';
        };

        ensureDnsRecords = {
          enable = mkEnableOption "declarative authoritative zones + record upsert";

          # NOTE: deliberately NO prune/delete. "ensure" = strict upsert of the
          # DECLARED records only. Records added manually or by other processes are
          # left untouched. There is no deletion path anywhere in this module.

          zones = mkOption {
            type = types.attrsOf zoneType;
            default = { };
            example = {
              "home.plato-splunk.media" = {
                type = "Primary";
                records = [
                  {
                    A = {
                      name = "augustus.home.plato-splunk.media";
                      address = "100.64.0.1";
                    };
                  }
                ];
              };
            };
            description = ''
              Authoritative zones (keyed by zone name) and the records to ensure within
              them. On each run the zone is created if absent, then each declared record
              is upserted with overwrite=true so the declared RRset converges to this
              value. Undeclared records are never read or deleted.
            '';
          };
        };
      };
    };
}
