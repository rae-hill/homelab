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

      hm.desktop-git
      hm.nixvim-complete
      hm.vscode
      hm.shell-zsh
      hm.themes-catppuccin
      hm.opencode

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
            signal-desktop
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
