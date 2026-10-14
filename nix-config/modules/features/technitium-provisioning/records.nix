{ config, ... }@topLevel:
{
  # ensureDnsRecords: strictly idempotent, upsert-only authoritative zone + record
  # provisioning. For each declared zone, create it if absent (guarded by zones/list),
  # then upsert each declared record with overwrite=true. There is NO deletion path:
  # records added manually or by other processes are never read or removed.
  flake.modules.nixos.technitium-provisioning-records =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      cfg = config.services.technitium-server-complete;
      prov = cfg.provision;
      ensure = prov.ensureDnsRecords;
      inherit (lib)
        mkIf
        concatStringsSep
        concatMapStringsSep
        mapAttrsToList
        optionalString
        escapeShellArg
        head
        attrNames
        ;

      provisionLib = topLevel.config.constants.technitiumProvisioning;
      apiBase = "http://127.0.0.1:${toString cfg.webHttpPort}";

      boolStr = b: if b then "true" else "false";

      # Resolve a record's owner name to the API `domain` parameter: "@"/"" -> zone
      # apex, otherwise the FQDN as-given.
      recDomain = zoneName: name: if name == "@" || name == "" then zoneName else name;

      # Per record type, map the submodule payload to the Technitium add-record query
      # parameters (as { apiParam = payloadValue; } pairs). The record type is the
      # attrTag key, so no runtime validation is needed — the module system already
      # guaranteed the required fields are present with the right types.
      typeParams = {
        A = p: { ipAddress = p.address; };
        AAAA = p: { ipAddress = p.address; };
        CNAME = p: { cname = p.cname; };
        TXT = p: { text = p.text; };
        MX = p: {
          exchange = p.exchange;
          preference = p.preference;
        };
        NS = p: { nameServer = p.nameServer; };
        SRV = p: {
          priority = p.priority;
          weight = p.weight;
          port = p.port;
          target = p.target;
        };
        CAA = p: {
          flags = p.flags;
          tag = p.tag;
          value = p.value;
        };
      };

      # Render the --data-urlencode args for a record's type-specific value params.
      renderValueArgs =
        params:
        concatStringsSep " " (
          mapAttrsToList (
            apiParam: v: "--data-urlencode ${escapeShellArg "${apiParam}=${toString v}"}"
          ) params
        );

      # Render a single upsert api_call for one record. `record` is a single-key
      # attrset { <TYPE> = payload; } (the attrTag union).
      renderRecord =
        zoneName: record:
        let
          recordType = head (attrNames record);
          payload = record.${recordType};
          domain = recDomain zoneName payload.name;
          valueArgs = renderValueArgs (typeParams.${recordType} payload);
          ttlArg = optionalString (
            payload.ttl != null
          ) " --data-urlencode ${escapeShellArg "ttl=${toString payload.ttl}"}";
        in
        ''
          api_call "upsert ${recordType} ${domain}" \
            "api/zones/records/add" \
            --data-urlencode ${escapeShellArg "zone=${zoneName}"} \
            --data-urlencode ${escapeShellArg "domain=${domain}"} \
            --data-urlencode ${escapeShellArg "type=${recordType}"} \
            --data-urlencode "overwrite=true" \
            ${valueArgs}${ttlArg} \
            >/dev/null
        '';

      # Render the zone-create + records-upsert block for one zone.
      renderZone =
        zoneName: zone:
        ''
          # --- zone: ${zoneName} ----------------------------------------------------
          if ! printf '%s' "$zones_json" | jq -e \
            --arg z ${escapeShellArg zoneName} \
            '.response.zones[]? | select(.name == $z)' >/dev/null; then
            api_call "create zone ${zoneName}" \
              "api/zones/create" \
              --data-urlencode ${escapeShellArg "zone=${zoneName}"} \
              --data-urlencode ${escapeShellArg "type=${zone.type}"} \
              --data-urlencode "useSoaSerialDateScheme=${boolStr zone.useSoaSerialDateScheme}" \
              >/dev/null
          fi
        ''
        + concatMapStringsSep "\n" (renderRecord zoneName) zone.records;

      zoneBlocks = concatStringsSep "\n" (mapAttrsToList renderZone ensure.zones);

      recordsScript = pkgs.writeShellApplication {
        name = "technitium-provision-records";
        runtimeInputs = provisionLib.baseRuntimeInputs pkgs;
        text =
          provisionLib.preamble {
            inherit apiBase;
            tokenSocketPath = prov.tokenSocketPath;
          }
          + ''
            # List existing zones once; renderZone guards create on this.
            zones_json="$(api_call "list zones" "api/zones/list")"

            ${zoneBlocks}

            echo "technitium-provision-records: completed"
          '';
      };
    in
    {
      config = mkIf (cfg.enable && prov.enable && ensure.enable) {
        systemd.services.technitium-provision-records = {
          description = "Technitium provisioning: ensure authoritative zones + records";
          after = [
            "technitium-dns-server.service"
            "technitium-provision-token.socket"
            "technitium-provision-settings.service"
          ];
          requires = [
            "technitium-dns-server.service"
            "technitium-provision-token.socket"
          ];
          wantedBy = [ "technitium-provision.target" ];

          serviceConfig = {
            Type = "oneshot";
            User = cfg.user;
            Group = cfg.group;
            SupplementaryGroups = [ prov.tokenGroup ];
            ExecStart = lib.getExe recordsScript;
            RemainAfterExit = true;
            Restart = "on-failure";
            RestartSec = "15s";
          };
          unitConfig = {
            StartLimitIntervalSec = "300";
            StartLimitBurst = 10;
          };
        };
      };
    };
}
