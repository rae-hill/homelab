{ config, pkgs, ... }:
{
  users.groups = {
    radiusd = {
      gid = 222;
    };
    hass = {
      gid = config.ids.gids.hass;
    };
    planka = {
      gid = 10666;
    };
    planka-certs = {
      gid = 11666;
    };
    planka-db-pass = {
      gid = 12666;
    };
    openwebui = {
      gid = 47955;
    };
    homelab-api = {
      gid = 26696;
    };
  };

  users.users = {
    jacob = {
      isNormalUser = true;
      description = "Jacob Alford";
      extraGroups = [
        "networkmanager"
        "wheel"
      ];
      packages = with pkgs; [ ];
      openssh.authorizedPrincipals = [
        "rae@plato-splunk.media"
      ];
      openssh.authorizedKeys.keys = [
        "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIKpkbeZ6o6dX4eTh/Ak1i9rnb41XohfQdUISJ9QQepnkAAAABHNzaDo="
      ];
      shell = pkgs.zsh;
    };
    rae = {
      isNormalUser = true;
      description = "Rae Hill";
      extraGroups = [
        "networkmanager"
        "wheel"
      ];
      packages = with pkgs; [ ];
      openssh.authorizedPrincipals = [
        "rae@plato-splunk.media"
      ];
      openssh.authorizedKeys.keys = [
        "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIKpkbeZ6o6dX4eTh/Ak1i9rnb41XohfQdUISJ9QQepnkAAAABHNzaDo="
        "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBD6gE/UA8NCZkxImg073c02kzh3P6ohV8DLzTXQeoJanwCDJgWYMsQI55XoYqanK8n/xooiKEkt3MCIAmG9EtTs="
      ];
      shell = pkgs.zsh;
    };
    restic = {
      isNormalUser = true;
    };
    radiusd = {
      isSystemUser = true;
      group = "radiusd";
      uid = 222;
    };
    hass = {
      home = "/var/lib/hass";
      createHome = true;
      group = "hass";
      uid = config.ids.uids.hass;
    };
    planka = {
      isSystemUser = true;
      home = "/var/lib/planka";
      group = "planka";
      uid = 10666;
    };
    openwebui = {
      isSystemUser = true;
      home = "/var/lib/open-webui";
      group = "openwebui";
      uid = 48955;
    };
    homelab-api = {
      isSystemUser = true;
      home = "/var/lib/homelab-api";
      group = "homelab-api";
      uid = 26697;
    };
  };
}
