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
    enableSyntaxHighlighting = true;
  };

  environment.systemPackages = [
    pkgs.step-cli
  ];

  # The Caddyfile global block + launchd daemon + the Jellyfin/metrics site blocks now live in
  # features/mini-jellyfin/ (catalog entries rendered by the darwin caddy generator). mini imports
  # darwin.homelab-service-apphost + darwin.mini-jellyfin from hosts/mini.nix.

  system.configurationRevision = inputs.self.rev or inputs.self.dirtyRev or null;

  system.primaryUser = "jacob";

  system.stateVersion = 6;

  nixpkgs.hostPlatform = "aarch64-darwin";

  nixpkgs.config.allowUnfree = true;
  nixpkgs.config.allowUnfreePredicate =
    pkg:
    builtins.elem (lib.getName pkg) [
    ];
}
