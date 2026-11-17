{
  flake.modules.homeManager.zsh =
    {
      inputs,
      lib,
      config,
      pkgs,
      ...
    }:
    {
      programs.zsh = {
        enable = true;
        enableCompletion = true;
        autosuggestion.enable = true;
        syntaxHighlighting.enable = true;

        oh-my-zsh = {
          enable = true;
          plugins = [ "git" ];
        };

        shellAliases = {
          gnome_restart = "sudo systemctl restart display-manager.service";

          ssh_udm = "TERM=vt100 ssh root@10.76.100.1";
          ssh_unas = "TERM=vt100 ssh root@nas.plato-splunk.media";
          ssh_aug = "TERM=vt100 ssh augustus.plato-splunk.media";
          ssh_mini = "TERM=vt100 ssh jacob@mini.neko-bicolor.ts.net";
          ssh_sis = "TERM=vt100 ssh cicero.plato-splunk.media";
          ssh_prae = "TERM=vt100 ssh praeconinus.neko-bicolor.ts.net";
          ssh_aed = "TERM=vt100 ssh aedilis.plato-splunk.media";
          ssh_aed_ts = "TERM=vt100 ssh aedilis.neko-bicolor.ts.net";
        };
      };
    };
}
