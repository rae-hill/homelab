{ inputs, ... }:
{
  flake.modules.nixos.host-augustus-filesystems =
    {
      inputs,
      lib,
      config,
      ...
    }:
    {
      # CIFS credentials for the /mnt/backups automount below, from the smb
      # per-service sops file (moved from the former augustus/sops.nix).
      sops.secrets.smb_passphrase = {
        sopsFile = ./secrets/smb.yaml;
        owner = "root";
      };
      sops.templates."smb-creds" = {
        content = ''
          username=augustus
          password=${config.sops.placeholder.smb_passphrase}
        '';
        owner = "root";
      };

      fileSystems."/mnt/backups" = {
        device = "//10.76.100.190/Personal-Drive";
        fsType = "cifs";
        options =
          let
            # this line prevents hanging on network split
            automount_opts = "x-systemd.automount,noauto,x-systemd.idle-timeout=60,x-systemd.device-timeout=5s,x-systemd.mount-timeout=5s,user,users";
          in
          [
            "${automount_opts},credentials=${
              config.sops.templates."smb-creds".path
            },uid=1001,gid=${toString config.users.groups.users.gid}"
          ];
      };
    };
}
