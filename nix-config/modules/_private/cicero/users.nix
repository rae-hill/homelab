{ pkgs, ... }:
{
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
        "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBD6gE/UA8NCZkxImg073c02kzh3P6ohV8DLzTXQeoJanwCDJgWYMsQI55XoYqanK8n/xooiKEkt3MCIAmG9EtTs="
      ];
      shell = pkgs.zsh;
    };
    rae = {
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
        "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBD6gE/UA8NCZkxImg073c02kzh3P6ohV8DLzTXQeoJanwCDJgWYMsQI55XoYqanK8n/xooiKEkt3MCIAmG9EtTs="
      ];
      shell = pkgs.zsh;
    };
  };
}
