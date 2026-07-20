{ inputs, config, ... }:
let
  hm = inputs.self.modules.homeManager;
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
        in
        {
          nixpkgs = {
            overlays = [ inputs.affinity-nix.overlays.default ];
            config = {
              allowUnfree = true;
              allowUnfreePredicate = _: true;
            };
          };

          home = {
            username = "jacob";
            homeDirectory = "/home/jacob";
          };

          home.packages = with pkgs; [
            steam
            protonup-ng
            kitty
            prismlauncher
            discord
            makemkv
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
            affinity-photo
            affinity-designer
            affinity-publisher
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

          programs.home-manager.enable = true;

          programs.ssh = {
            enable = true;
            enableDefaultConfig = false;
            settings = {
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
          };

          catppuccin = {
            enable = true;
            flavor = "frappe";
            accent = "sapphire";
            starship.enable = true;
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
