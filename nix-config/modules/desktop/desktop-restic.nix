{
  flake.modules.nixos.desktop-restic =
    {
      config,
      lib,
      pkgs,
      inputs,
      ...
    }:
    {
      imports = [ inputs.self.modules.nixos.users-restic ];

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
