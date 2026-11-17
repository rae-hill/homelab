{ inputs, ... }:
{
  flake.modules.nixos.host-nixos-filesystems =
    {
      inputs,
      lib,
      config,
      ...
    }:
    let
      sopsFile = ./secrets/smb.yaml;
    in
    # TODO: Move to modules/system/system-filesystems.nix
    {
      # CIFS credentials for the two automounts below, from the smb per-service
      # sops file (moved from the former system-configs/nixos/sops.nix).
      sops.secrets = {
        smb_passphrase = {
          inherit sopsFile;
          owner = "root";
        };
        jacob_smb_passphrase = {
          inherit sopsFile;
          owner = "root";
        };
      };
      sops.templates."smb-creds" = {
        content = ''
          username=nixos
          password=${config.sops.placeholder.smb_passphrase}
        '';
        owner = "root";
      };
      sops.templates."jacob-smb-creds" = {
        content = ''
          username=jacob-alford
          password=${config.sops.placeholder.jacob_smb_passphrase}
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

      fileSystems."/home/jacob/cloud" = {
        device = "//10.76.100.190/Personal-Drive";
        fsType = "cifs";
        options =
          let
            # this line prevents hanging on network split
            automount_opts = "x-systemd.automount,noauto,x-systemd.idle-timeout=60,x-systemd.device-timeout=5s,x-systemd.mount-timeout=5s,user,users";
          in
          [
            "${automount_opts},credentials=${
              config.sops.templates."jacob-smb-creds".path
            },uid=1000,gid=${toString config.users.groups.users.gid}"
          ];
      };
    };
}
