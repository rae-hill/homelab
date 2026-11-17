{
  flake.modules.nixos.cifs =
    { config, lib, pkgs, ... }:
    {
      security.wrappers."mount.cifs" = {
        program = "mount.cifs";
        source = "${lib.getBin pkgs.cifs-utils}/bin/mount.cifs";
        owner = "root";
        group = "root";
        setuid = true;
      };
    };
}
