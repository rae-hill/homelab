{ config, lib, ... }:
{
  # Register the technitium-provisioning shell scripts into the ShellCheck gate.
  #
  # The scripts are built inside the aedilis NixOS evaluation (they interpolate host
  # option values), and each provisioning unit stashes its generated script package in
  # the internal `provision._lintScripts` list. We harvest that list here and register
  # each package as a lint spec. Building `checks.shellcheck` then forces each script's
  # writeShellApplication ShellCheck checkPhase to run under `nix flake check` — without
  # building the whole aedilis host.
  #
  # These packages are x86_64-linux (aedilis's system), matching the Linux-only scope of
  # checks.shellcheck, so the spec ignores the per-system pkgs and returns the package
  # directly. aedilis is a representative source: other hosts reuse the same provisioning
  # modules, so the script text is identical.
  flake.lintedShellScripts =
    let
      aedilis = config.flake.nixosConfigurations.aedilis or null;
      scripts =
        if aedilis == null then
          [ ]
        else
          aedilis.config.services.technitium-server-complete.provision._lintScripts;
    in
    map (pkg: (_pkgs: pkg)) scripts;
}
