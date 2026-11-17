{
  lib,
  config,
  pkgs,
  ...
}:
{
  # Boot (system-boot-generic), networking/DNS (system-networking +
  # system-networking-forwarding), locale (system-locale), and allowUnfree
  # (system-nix-base) come from modules/system — wired in default.nix.

  services.getty.autologinUser = "jacob";

  system.stateVersion = "25.05";
}
