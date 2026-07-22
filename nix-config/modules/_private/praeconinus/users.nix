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
        "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIKpkbeZ6o6dX4eTh/Ak1i9rnb41XohfQdUISJ9QQepnkAAAABHNzaDo= yk3-ssh-ed25519"
        "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIApcg0ug0kJ6QAsv/hDOyva7qk7efKQhBzI1Ty4J7nISAAAABHNzaDo= yk1-ssh-ed25519"
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
        "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIKpkbeZ6o6dX4eTh/Ak1i9rnb41XohfQdUISJ9QQepnkAAAABHNzaDo= yk3-ssh-ed25519"
        "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIApcg0ug0kJ6QAsv/hDOyva7qk7efKQhBzI1Ty4J7nISAAAABHNzaDo= yk1-ssh-ed25519"
      ];
      shell = pkgs.zsh;
    };
  };
}
