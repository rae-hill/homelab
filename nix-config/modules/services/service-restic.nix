{
  flake.modules.nixos.restic =
    { config, lib, pkgs, ... }:
    {
      security.wrappers.restic = {
        program = "restic";
        source = "${pkgs.restic.out}/bin/restic";
        owner = "restic";
        group = "users";
        permissions = "u=rwx,g=,o=";
        capabilities = "cap_dac_read_search=+ep";
      };
    };
}
