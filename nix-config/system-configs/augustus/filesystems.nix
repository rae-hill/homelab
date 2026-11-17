{ lib, config, ... }:
{
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
}
