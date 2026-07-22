{ pkgs, ... }:
{
  users.users = {
    jacob = {
      isNormalUser = true;
      description = "Jacob Alford";
      openssh.authorizedPrincipals = [
        "rae@plato-splunk.media"
      ];
      openssh.authorizedKeys.keys = [
        "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIKpkbeZ6o6dX4eTh/Ak1i9rnb41XohfQdUISJ9QQepnkAAAABHNzaDo="
      ];
      extraGroups = [
        "networkmanager"
        "wheel"
        "podman"
      ];
      packages = with pkgs; [ ];
      shell = pkgs.zsh;
    };
    rae = {
      isNormalUser = true;
      description = "Rae Hill";
      openssh.authorizedPrincipals = [
        "rae@plato-splunk.media"
      ];
      openssh.authorizedKeys.keys = [
        "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIKpkbeZ6o6dX4eTh/Ak1i9rnb41XohfQdUISJ9QQepnkAAAABHNzaDo="
      ];
      extraGroups = [
        "networkmanager"
        "wheel"
        "podman"
      ];
      packages = with pkgs; [ ];
      shell = pkgs.zsh;
    };
    restic = {
      isNormalUser = true;
    };
  };
}
