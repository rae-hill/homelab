# openclaw — user-level OpenClaw AI-agent gateway (darwin, mini).
#
# Runs `openclaw gateway run` as jacob via launchd.user.agents (upstream supports per-user
# LaunchAgents only — no root daemons). Nix renders a JSON5 config skeleton into /etc; the
# wrapper copies it to the REAL file ~/.openclaw/openclaw.json at start (openclaw avoids
# symlinked config layouts, and /etc entries are store symlinks) with OPENCLAW_NIX_MODE=1
# (immutable config: writers like doctor/onboard refuse and print merge patches instead;
# config changes flow through nix-config). Mutable state (sessions, credentials, workspace)
# lives in ~jacob/.openclaw. Secrets come from sops (/run/secrets, owner jacob) and are
# exported by the wrapper — the config references them via ${VAR} substitution only.
#
# Config schema is STRICT (unknown keys refuse startup, exit 78); keys verified against
# openclaw v2026.10.3 bundled docs (gateway/configuration.md, config-gateway.md,
# providers/openrouter.md, config-extensions.md). See docs/openclaw-mini-plan.md (D1–D8).
{ ... }:
{
  flake.modules.darwin.openclaw-service =
    {
      inputs,
      pkgs,
      pkgs-unstable,
      config,
      ...
    }:
    let
      openclaw = pkgs-unstable.openclaw;
      protonMailMcp = inputs.self.packages.aarch64-darwin.proton-mail-mcp;

      secretNames = [
        "openclaw_gateway_token"
        "openrouter_api_key"
        "kagi_api_key"
        "proton_bridge_username"
        "proton_bridge_password"
      ];
      secretPath = name: config.sops.secrets.${name}.path;

      # Waits for sops-install-secrets (boot race with the login agent), stages the Nix-rendered
      # config as a real file, then execs the gateway.
      gatewayWrapper = pkgs.writeShellScript "openclaw-gateway" ''
        set -eu

        i=0
        while [ $i -lt 120 ]; do
          ok=1
        ${builtins.concatStringsSep "\n      " (map (n: ''[ -r "${secretPath n}" ] || ok=0'') secretNames)}
          [ "$ok" = 1 ] && break
          sleep 1
          i=$((i + 1))
        done

        mkdir -p "$HOME/.openclaw" "$HOME/Library/Logs/openclaw"
        # Real-file config: /etc/openclaw/openclaw.json is a store symlink; openclaw docs
        # advise pointing OPENCLAW_CONFIG_PATH at a regular file even in read-only mode.
        cat /etc/openclaw/openclaw.json > "$HOME/.openclaw/openclaw.json"
        chmod 0600 "$HOME/.openclaw/openclaw.json"

        # The launchd plist gives us a coreutils-only PATH; broaden it for the gateway and
        # any stdio MCP servers it spawns (NIX_MODE also folds in NIX_PROFILES at runtime).
        export PATH="$HOME/.nix-profile/bin:/run/current-system/sw/bin:${openclaw}/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

        export OPENCLAW_CONFIG_PATH="$HOME/.openclaw/openclaw.json"
        # Nix owns config + the launchd plist: immutable config, doctor diagnostic-only,
        # NIX_PROFILES PATH discovery for stdio MCP commands.
        export OPENCLAW_NIX_MODE=1
        export OPENCLAW_SERVICE_REPAIR_POLICY=external
        export OPENCLAW_GATEWAY_TOKEN="$(cat "${secretPath "openclaw_gateway_token"}")"
        export OPENROUTER_API_KEY="$(cat "${secretPath "openrouter_api_key"}")"
        export KAGI_API_KEY="$(cat "${secretPath "kagi_api_key"}")"
        # Proton Mail Bridge mailbox creds (Bridge GUI → "Mailbox details"); consumed by the
        # proton-mail-mcp stdio server via ''${PROTON_*} substitution in the rendered config.
        export PROTON_BRIDGE_USERNAME="$(cat "${secretPath "proton_bridge_username"}")"
        export PROTON_BRIDGE_PASSWORD="$(cat "${secretPath "proton_bridge_password"}")"

        exec ${openclaw}/bin/openclaw gateway run
      '';
    in
    {
      environment.systemPackages = [
        openclaw
        protonMailMcp
      ];

      # JSON5 skeleton. Secrets are NEVER rendered here — only ${VAR} env substitution
      # (uppercase names; wrapper exports them). ''${ escapes Nix interpolation.
      environment.etc."openclaw/openclaw.json".text = ''
        // Rendered by nix-config (features/openclaw/service.nix) — do not edit; change Nix.
        // OPENCLAW_NIX_MODE=1: writers (onboard/doctor/config set) refuse; state dir stays writable.
        {
          gateway: {
            mode: "local",
            port: 18789,
            bind: "loopback", // WS control + Control UI on 127.0.0.1 only; Caddy fronts it
            // Reverse-proxy requirements (verified vs v2026.10.5 docs: gateway/security/
            // network-exposure.md, config-gateway.md, rate-limiting.md):
            // - trustedProxies: without it, same-host proxy traffic gets 403
            //   proxy_attribution_required (loopback socket + XFF from unlisted proxy).
            // - publicOrigin: feeds controlUi.allowedOrigins — plato-splunk.media is NOT in
            //   the auto-accepted set (loopback/RFC1918/.ts.net/.local/CGNAT), so browser
            //   origin checks would reject the vhost without it.
            publicOrigin: "https://openclaw.plato-splunk.media",
            trustedProxies: ["127.0.0.1"],
            auth: { mode: "token" }, // token supplied via OPENCLAW_GATEWAY_TOKEN env;
            // NOT trusted-proxy mode: our Caddy is a plain TLS terminator, not identity-aware
            // (docs: "When NOT to use trusted-proxy"). /v1/* bearer = full operator access —
            // treat the vhost as admin-grade exposure on the tailnet.
            reload: { mode: "off" }, // Nix generations swap the file; no hot reload
          },
          logging: {
            file: "/Users/jacob/Library/Logs/openclaw/gateway.log",
          },
          agents: {
            defaults: {
              model: { primary: "openrouter/auto" }, // OPENROUTER_API_KEY env; refine model later
            },
          },
          mcp: {
            servers: {
              kagi: {
                url: "https://mcp.kagi.com/mcp",
                transport: "streamable-http",
                headers: { Authorization: "Bearer ''${KAGI_API_KEY}" },
                requestTimeoutMs: 20000,
                toolFilter: { include: ["kagi_search_fetch", "kagi_extract"] },
              },
              protonmail: {
                command: "${protonMailMcp}/bin/proton-mail-mcp",
                env: {
                  PROTON_BRIDGE_USERNAME: "''${PROTON_BRIDGE_USERNAME}",
                  PROTON_BRIDGE_PASSWORD: "''${PROTON_BRIDGE_PASSWORD}",
                  // Read + label (jacob 2026-11-09). Whitelist = exact Proton label names
                  // (case-sensitive, comma-separated; spaces OK, slashes/NUL rejected at
                  // startup). Enforced 3x: tool visibility gates, handler checks, IMAP layer —
                  // see packages/proton-mail-mcp + docs/openclaw-mini-plan.md.
                  PROTON_MCP_OPERATIONS: "read,label",
                  PROTON_MCP_ALLOWED_LABELS: "Declined,Applied,Needs Follow-Up,Job Hunt",
                },
                toolFilter: { include: ["mail_*"] },
              },
            },
          },
        }
      '';

      sops.secrets = builtins.listToAttrs (
        map (name: {
          inherit name;
          value = {
            owner = "jacob";
            group = "staff";
            mode = "0400";
          };
        }) secretNames
      );

      # Interactive CLI ergonomics: EVERY shell on mini must know the service is externally
      # managed. The wrapper exports this for the daemon itself, but without it system-wide,
      # `openclaw gateway status`/`doctor` run from a shell look for upstream's own LaunchAgent
      # (ai.openclaw.gateway), don't find it, and flag our healthy launchd agent as a foreign
      # squatter ("Port 18789 already in use", PID = nix-store node). With it, the CLI is
      # diagnostic-only for service lifecycle (docs: gateway/index.md, install/nix.md).
      environment.variables.OPENCLAW_SERVICE_REPAIR_POLICY = "external";

      # Headless persistence: the user LaunchAgent only runs inside jacob's Aqua session.
      # FileVault caveat: with FileVault on, boot stops at the unlock screen first (plan D2).
      system.defaults.loginwindow.autoLoginUser = "jacob";

      # launchd opens StandardOutPath before the wrapper's mkdir can run — pre-create the dir.
      system.activationScripts.openclawLogDir.text = ''
        mkdir -p /Users/jacob/Library/Logs/openclaw
        chown jacob:staff /Users/jacob/Library/Logs/openclaw
      '';

      launchd.user.agents.openclaw = {
        command = "${gatewayWrapper}";
        path = [ pkgs.coreutils ];
        serviceConfig = {
          KeepAlive = true;
          RunAtLoad = true;
          StandardOutPath = "/Users/jacob/Library/Logs/openclaw/gateway.out.log";
          StandardErrorPath = "/Users/jacob/Library/Logs/openclaw/gateway.err.log";
        };
      };
    };
}
