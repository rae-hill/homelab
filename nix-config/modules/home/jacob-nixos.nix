{ inputs, config, ... }:
let
  hm = inputs.self.modules.homeManager;
  # Port/URL facts for the opencode web vhost, shared with the NixOS side
  # (features/opencode + service-registry.nix).
  opencodeSvc = config.constants.services.opencode;
in
{
  flake.homeConfigurations."jacob@nixos" = inputs.home-manager.lib.homeManagerConfiguration {
    pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
    extraSpecialArgs = {
      inherit inputs;
      pkgs-unstable = import inputs.nixpkgs-unstable {
        system = "x86_64-linux";
        config.allowUnfree = true;
      };
    };
    modules = [
      inputs.catppuccin.homeModules.catppuccin
      inputs.nixvim.homeModules.nixvim
      inputs.sops-nix.homeManagerModules.sops

      hm.git
      hm.nixvim-complete
      hm.vscode
      hm.zsh
      hm.desktop-theming

      (
        {
          inputs,
          lib,
          config,
          pkgs,
          pkgs-unstable,
          ...
        }:
        let
          identityAgent = "/run/user/1000/ssh-agent";
          vivaldi-nvidia = pkgs.vivaldi.override {
            commandLineArgs = [
              "--ozone-platform=x11"
            ];
            enableWidevine = true;
          };

          # Same plugin set and versions as the flake devshell / dprint.json, so
          # opencode's auto-formatter produces identical output to `fmt`.
          dprintPlugins = with pkgs.dprint-plugins; [
            dprint-plugin-typescript
            dprint-plugin-json
            dprint-plugin-markdown
            dprint-plugin-toml
            g-plane-malva
            g-plane-markup_fmt
            g-plane-pretty_yaml
          ];
          dprintPluginPaths = map (p: "${p}/plugin.wasm") dprintPlugins;

          # V2 shell rules match the whole command string; a trailing " *" also
          # matches the bare command with no arguments.
          allowShell =
            cmds:
            map (cmd: {
              action = "shell";
              resource = "${cmd} *";
              effect = "allow";
            }) cmds;
        in
        {
          nixpkgs = {
            overlays = [ ];
            config = {
              allowUnfree = true;
              allowUnfreePredicate = _: true;
            };
          };

          home = {
            username = "jacob";
            homeDirectory = "/home/jacob";
          };

          sops = {
            defaultSopsFile = inputs.self + "/nix-config/secrets/nixos.yaml";
            age.keyFile = "/home/jacob/.config/sops/age/keys.txt";

            secrets.qwen_openai_key = { };
          };

          home.packages = with pkgs; [
            steam
            protonup-ng
            kitty
            prismlauncher
            discord
            proton-vpn
            bolt-launcher
            mullvad-browser
            yubikey-manager
            finamp
            freecad-wayland
            httpie
            dmidecode
            popsicle
            google-fonts
            font-awesome
            typst
            pkgs-unstable.kiro-cli
            pkgs-unstable.kiro
            jq
            vlc
            step-cli
            teams-for-linux
            vivaldi-nvidia
            clipboard-jh
          ];

          dconf = {
            enable = true;
          };

          home.sessionVariables = {
            STEAM_EXTRA_COMPAT_TOOLS_PATHS = "\${HOME}/.steam/root/compatibilitytools.d";
            SSH_AUTH_SOCK = "$XDG_RUNTIME_DIR/ssh-agent";
            EDITOR = "nvim";
            CA_URL = "https://ca.plato-splunk.media";
            CA_FINGERPRINT = "56c220018d0c65d5283d46d7c769eb471c18b2e903b205a9457261b2c52f2392";
          };

          programs.kitty = {
            enable = true;
            enableGitIntegration = true;
            font.name = "victor-mono";
          };

          programs.ghostty = {
            enable = true;
            enableZshIntegration = true;
            settings = {
              font-family = "victor-mono";
            };
          };

          programs.mangohud = {
            enable = true;
            settings = {
              gpu_temp = true;
              gpu_core_clock = true;
              gpu_load_value = true;
              gpu_fan = true;
              cpu_temp = true;
              cpu_mhz = true;
              cpu_load_value = true;
            };
          };

          programs.opencode = {
            enable = true;
            # V2 (2.x). Stable nixpkgs pins 1.x, whose config schema is
            # incompatible (permission/bash vs permissions/shell).
            package = pkgs-unstable.opencode;
            # Web UI server: the `opencode-web` systemd USER service runs
            # `opencode serve` on LOOPBACK only — fronted by the NixOS Caddy
            # mTLS vhost https://opencode.plato-splunk.media (features/opencode;
            # tailscale0-only :443, never LAN/public). The port comes from
            # constants.services.opencode.port and is deliberately NOT
            # opencode's 49374 channel default, so the standalone web server
            # never fights the shared background service the local TUI spawns.
            web = {
              enable = true;
              extraArgs = [
                "--hostname"
                "127.0.0.1"
                "--port"
                (toString opencodeSvc.port)
              ];
              # Basic-auth password for the web UI (username is always
              # "opencode"). A deliberate throwaway: the Caddy mTLS gate means
              # no request reaches this server without a step-ca client cert.
              # NOTE: opencode v2 reads OPENCODE_PASSWORD (the home-manager
              # module docs still say OPENCODE_SERVER_PASSWORD — stale).
              environmentFile = pkgs.writeText "opencode-web.env" ''
                OPENCODE_PASSWORD=hackme
              '';
            };
            settings = {
              # Ordered rules; LAST match wins. See https://opencode.ai/v2/docs/permissions
              permissions = [
                # Edits within the project are unrestricted; external paths are
                # gated by external_directory below.
                {
                  action = "edit";
                  resource = "*";
                  effect = "allow";
                }
                # Outside the project: ask, except repos under ~/git.
                {
                  action = "external_directory";
                  resource = "*";
                  effect = "ask";
                }
                {
                  action = "external_directory";
                  resource = "~/git/*";
                  effect = "allow";
                }
                # Web fetches always ask.
                {
                  action = "webfetch";
                  resource = "*";
                  effect = "ask";
                }
                # Shell: ask by default, allowlist below, hard denies last.
                {
                  action = "shell";
                  resource = "*";
                  effect = "ask";
                }
              ]
              ++ allowShell [
                # read-only inspection
                "cat"
                "cut"
                "date"
                "df"
                "diff"
                "du"
                "echo"
                "fd"
                "file"
                "find"
                "grep"
                "head"
                "hostname"
                "jq"
                "ls"
                "ps"
                "pwd"
                "rg"
                "sort"
                "stat"
                "tail"
                "tr"
                "tree"
                "uname"
                "uniq"
                "wc"
                "which"
                # non-destructive file ops (rm/chmod/chown still ask)
                "cp"
                "ln"
                "mkdir"
                "mv"
                "touch"
                # git inspection + the repo's agent commit convention
                # (plain `git commit`/`git push` still ask)
                "git add"
                "git branch"
                "git commit --no-verify"
                "git diff"
                "git fetch"
                "git log"
                "git show"
                "git stash list"
                "git status"
                # nix / node / devshell project tooling
                "dprint check"
                "dprint fmt"
                "nix build"
                "nix develop"
                "nix eval"
                "nix flake check"
                "nix flake metadata"
                "nix fmt"
                "nix run"
                "nixos-rebuild"
                "update-missing-hashes"
                "yarn"
              ]
              ++ [
                # secrets management and privilege escalation are never autonomous
                {
                  action = "shell";
                  resource = "sops *";
                  effect = "deny";
                }
                {
                  action = "shell";
                  resource = "sudo *";
                  effect = "deny";
                }
              ];

              formatter = {
                # One dprint formatter covering every language configured in
                # flake.nix/dprint.json. `--allow-no-files` before `--plugins`
                # (flags after `--` are treated as file patterns), store-pinned
                # wasm plugins, `--` so $FILE is not swallowed by --plugins.
                # Runs from the project dir so dprint.json supplies the
                # per-language settings; DPRINT_CACHE_DIR mirrors the devshell.
                dprint = {
                  command = [
                    "${pkgs.dprint}/bin/dprint"
                    "fmt"
                    "--allow-no-files"
                    "--plugins"
                  ]
                  ++ dprintPluginPaths
                  ++ [
                    "--"
                    "$FILE"
                  ];
                  extensions = [
                    # dprint-plugin-typescript (js + ts)
                    ".ts"
                    ".tsx"
                    ".mts"
                    ".cts"
                    ".js"
                    ".jsx"
                    ".mjs"
                    ".cjs"
                    # dprint-plugin-json
                    ".json"
                    ".jsonc"
                    # dprint-plugin-markdown
                    ".md"
                    # dprint-plugin-toml
                    ".toml"
                    # malva (CSS)
                    ".css"
                    ".scss"
                    ".less"
                    # markup_fmt (HTML/XML/Vue/Svelte/Astro)
                    ".html"
                    ".htm"
                    ".xml"
                    ".vue"
                    ".svelte"
                    ".astro"
                    # pretty_yaml
                    ".yaml"
                    ".yml"
                  ];
                  environment = {
                    DPRINT_CACHE_DIR = "/home/jacob/.cache/dprint";
                  };
                };

                # Built-ins are registered before custom entries, so disable the
                # ones that overlap the dprint languages; otherwise e.g. a
                # project-local prettier would win over dprint.
                prettier.disabled = true;
                oxfmt.disabled = true;
                biome.disabled = true;

                # .nix: pinned nixfmt (RFC style) via store path so it does not
                # depend on PATH — same version as `nix run .#nixfmt`.
                nixfmt.command = [
                  "${pkgs.nixfmt}/bin/nixfmt"
                  "$FILE"
                ];
              };

              # Default model for new sessions; without it V2 falls back to the
              # "newest available supported model" in the whole catalog, which
              # may point at an unconnected provider.
              model = "qwencloud-token-plan-personal/qwen3.8-max";

              # V2 providers schema (https://opencode.ai/v2/docs/providers):
              # `provider` → `providers`, `npm` → `package` (the runtime package,
              # not the raw ai-sdk one), `options` → `settings`, model
              # `modalities`/`reasoning` → `capabilities`, and request-specific
              # model options go to raw `body` merges (wire format, so Anthropic
              # `budget_tokens` stays snake_case).
              providers = {
                "qwencloud-token-plan-personal" = {
                  name = "QwenCloud";
                  package = "@opencode/ai/providers/anthropic-compatible";
                  settings = {
                    baseURL = "https://token-plan.maas.qwencloudapi.com/apps/anthropic/v1";
                    apiKey = "{file:${config.sops.secrets.qwen_openai_key.path}}";
                  };

                  models = {
                    auto = {
                      name = "Auto";
                      capabilities = {
                        input = [ "text" ];
                        output = [ "text" ];
                      };
                    };

                    "qwen3.8-max" = {
                      name = "Qwen3.8 Max";
                      limit = {
                        context = 983616;
                        output = 131072;
                      };
                      capabilities = {
                        input = [
                          "text"
                          "image"
                        ];
                        output = [ "text" ];
                        reasoning.supported = true;
                      };
                      # was V1 `options.effort = "xhigh"`
                      body.effort = "xhigh";
                    };

                    "qwen3.8-flash" = {
                      name = "Qwen3.8 Flash";
                      limit = {
                        context = 983616;
                        output = 131072;
                      };
                      capabilities = {
                        input = [
                          "text"
                          "image"
                        ];
                        output = [ "text" ];
                        reasoning.supported = true;
                      };
                      body.effort = "xhigh";
                    };

                    "qwen3.7-max" = {
                      name = "Qwen3.7 Max";
                      capabilities.reasoning.supported = true;
                      body.thinking = {
                        type = "enabled";
                        budget_tokens = 8192;
                      };
                    };

                    "qwen3.7-plus" = {
                      name = "Qwen3.7 Plus";
                      capabilities = {
                        input = [
                          "text"
                          "image"
                        ];
                        output = [ "text" ];
                        reasoning.supported = true;
                      };
                      body.thinking = {
                        type = "enabled";
                        budget_tokens = 8192;
                      };
                    };

                    "qwen3.6-plus" = {
                      name = "Qwen3.6 Plus";
                      capabilities = {
                        input = [
                          "text"
                          "image"
                        ];
                        output = [ "text" ];
                        reasoning.supported = true;
                      };
                      body.thinking = {
                        type = "enabled";
                        budget_tokens = 8192;
                      };
                    };

                    "qwen3.6-flash" = {
                      name = "Qwen3.6 Flash";
                      capabilities = {
                        input = [
                          "text"
                          "image"
                        ];
                        output = [ "text" ];
                        reasoning.supported = true;
                      };
                      body.thinking = {
                        type = "enabled";
                        budget_tokens = 8192;
                      };
                    };

                    "glm-5.3" = {
                      name = "GLM-5.3";
                      capabilities.reasoning.supported = true;
                      body.thinking = {
                        type = "enabled";
                        budget_tokens = 8192;
                      };
                    };

                    "glm-5.2" = {
                      name = "GLM-5.2";
                      capabilities.reasoning.supported = true;
                      body.thinking = {
                        type = "enabled";
                        budget_tokens = 8192;
                      };
                    };

                    "deepseek-v4-pro" = {
                      name = "DeepSeek V4 Pro";
                    };

                    "deepseek-v4-pro-0813" = {
                      name = "DeepSeek V4 Pro 0813";
                    };

                    "deepseek-v4-flash-0731" = {
                      name = "DeepSeek V4 Flash 0731";
                    };

                    "deepseek-v4.1-flash" = {
                      name = "DeepSeek V4.1 Flash";
                    };

                    "deepseek-v4.1-flash-1017" = {
                      name = "DeepSeek V4.1 Flash 1017";
                    };
                  };
                };
              };
            };
          };

          # OpenCode V2 keeps terminal-client settings (theme, ...) in cli.json;
          # the catppuccin home-manager module (release-26.05) still writes the
          # V1-era tui.json, which V2 ignores. Mirror the theme here so
          # catppuccin-frappe keeps applying.
          xdg.configFile."opencode/cli.json".text = builtins.toJSON {
            theme = {
              name = "catppuccin-frappe";
              mode = "dark";
            };
          };

          programs.home-manager.enable = true;

          programs.ssh = {
            enable = true;
            enableDefaultConfig = false;
            settings = {
              "aedilis.plato-splunk.media" = {
                inherit identityAgent;
                user = "admin";
                addKeysToAgent = "yes";
                forwardAgent = true;
                identityFile = "~/.ssh/yk_ssh_keys/id_ed25519_sk";
              };
              "aedilis.neko-bicolor.ts.net" = {
                inherit identityAgent;
                user = "admin";
                addKeysToAgent = "yes";
                forwardAgent = true;
                identityFile = "~/.ssh/yk_ssh_keys/id_ed25519_sk";
              };
              "augustus.plato-splunk.media" = {
                inherit identityAgent;
                user = "jacob";
                forwardAgent = true;
                userKnownHostsFile = "~/.step/known_hosts";
                proxyCommand = "step ssh proxycommand %r %h %p --provisioner \"kanidm\"";
                identitiesOnly = false;
              };
              "cicero.plato-splunk.media" = {
                inherit identityAgent;
                user = "jacob";
                forwardAgent = true;
                userKnownHostsFile = "~/.step/known_hosts";
                proxyCommand = "step ssh proxycommand %r %h %p --provisioner \"kanidm\"";
                identitiesOnly = false;
              };
              "mini.plato-splunk.media" = {
                inherit identityAgent;
                user = "jacob";
                forwardAgent = true;
                userKnownHostsFile = "~/.step/known_hosts";
                proxyCommand = "step ssh proxycommand %r %h %p --provisioner \"kanidm\"";
                identitiesOnly = false;
              };
              "exec \"step ssh check-host %h\"" = {
                inherit identityAgent;
                user = "jacob";
                forwardAgent = true;
                userKnownHostsFile = "~/.step/known_hosts";
                proxyCommand = "step ssh proxycommand %r %h %p --provisioner \"kanidm\"";
                identitiesOnly = false;
              };
              "augustus.neko-bicolor.ts.net" = {
                inherit identityAgent;
                user = "jacob";
                addKeysToAgent = "yes";
                forwardAgent = true;
                identityFile = "~/.ssh/yk_ssh_keys/id_ed25519_sk_yk3_backup";
              };
              "cicero.neko-bicolor.ts.net" = {
                inherit identityAgent;
                user = "jacob";
                addKeysToAgent = "yes";
                forwardAgent = true;
                identityFile = "~/.ssh/yk_ssh_keys/id_ed25519_sk_yk3_backup";
              };
              "praeconinus.neko-bicolor.ts.net" = {
                inherit identityAgent;
                user = "jacob";
                addKeysToAgent = "yes";
                forwardAgent = true;
                identityFile = [
                  "~/.ssh/yk_ssh_keys/id_ed25519_sk"
                  # "~/.ssh/yk_ssh_keys/id_ed25519_sk_yk3_backup"
                ];
              };
              "mini.neko-bicolor.ts.net" = {
                inherit identityAgent;
                user = "jacob";
                addKeysToAgent = "yes";
                forwardAgent = true;
                identityFile = "~/.ssh/yk_ssh_keys/id_ed25519_sk";
              };
              "github.com" = {
                user = "git";
                identityFile = "~/.ssh/yk_ssh_keys/id_ed25519_sk";
              };
              "*" = {
                forwardAgent = false;
                addKeysToAgent = "no";
                compression = false;
                serverAliveInterval = 0;
                serverAliveCountMax = 3;
                hashKnownHosts = false;
                userKnownHostsFile = "~/.ssh/known_hosts";
                controlMaster = "no";
                controlPath = "~/.ssh/master-%r@%n:%p";
                controlPersist = "no";
              };
            };
            extraConfig = ''
              IdentitiesOnly yes
              IdentityAgent none
            '';
          };

          programs.starship = {
            enable = true;
            enableZshIntegration = true;
            # Catppuccin Frappé palette inlined instead of using
            # `catppuccin.starship.enable`. The catppuccin starship module injects
            # the palette via `lib.importTOML "${sources.starship}/frappe.toml"`;
            # which is Import-From-Derivation: it must BUILD the catppuccin-starship
            # source at eval time. That breaks `nix flake check --no-build` (used by
            # the lint-staged pre-commit hook) with "path ... is not valid". Inlining
            # the palette removes the IFD entirely while keeping the identical theme.
            settings = {
              palette = "catppuccin_frappe";
              palettes.catppuccin_frappe = {
                rosewater = "#f2d5cf";
                flamingo = "#eebebe";
                pink = "#f4b8e4";
                mauve = "#ca9ee6";
                red = "#e78284";
                maroon = "#ea999c";
                peach = "#ef9f76";
                yellow = "#e5c890";
                green = "#a6d189";
                teal = "#81c8be";
                sky = "#99d1db";
                sapphire = "#85c1dc";
                blue = "#8caaee";
                lavender = "#babbf1";
                text = "#c6d0f5";
                subtext1 = "#b5bfe2";
                subtext0 = "#a5adce";
                overlay2 = "#949cbb";
                overlay1 = "#838ba7";
                overlay0 = "#737994";
                surface2 = "#626880";
                surface1 = "#51576d";
                surface0 = "#414559";
                base = "#303446";
                mantle = "#292c3c";
                crust = "#232634";
              };
            };
          };

          catppuccin = {
            enable = true;
            flavor = "frappe";
            accent = "sapphire";
            # starship palette is inlined above (see note) to avoid IFD in
            # `nix flake check --no-build`.
            starship.enable = false;
            kitty.enable = true;
            ghostty.enable = true;
            vivaldi.enable = true;
            mangohud.enable = true;
          };

          systemd.user.startServices = "sd-switch";

          home.stateVersion = "24.05";
        }
      )
    ];
  };
}
