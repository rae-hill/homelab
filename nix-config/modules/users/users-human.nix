# Human users. `users-human` is the aggregate every NixOS host imports; the
# per-user modules exist for selective use. SSH authorized keys are the UNION
# of the fleet's keys (yk3 + yk5 security keys, ecdsa) — remote access is
# additionally gated by services.openssh.settings.AllowUsers (defaults to
# [ "jacob" ] via the shell-ssh openssh module; aedilis overrides to admin).
{ inputs, ... }:
let
  authorizedPrincipals = [ "rae@plato-splunk.media" ];
  authorizedKeys = [
    "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIKpkbeZ6o6dX4eTh/Ak1i9rnb41XohfQdUISJ9QQepnkAAAABHNzaDo= yk3-ssh-ed25519"
    "sk-ssh-ed25519@openssh.com AAAAGnNrLXNzaC1lZDI1NTE5QG9wZW5zc2guY29tAAAAIApcg0ug0kJ6QAsv/hDOyva7qk7efKQhBzI1Ty4J7nISAAAABHNzaDo= yk5-ssh-ed25519"
    "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBD6gE/UA8NCZkxImg073c02kzh3P6ohV8DLzTXQeoJanwCDJgWYMsQI55XoYqanK8n/xooiKEkt3MCIAmG9EtTs="
  ];
in
{
  flake.modules.nixos.users-jacob =
    { pkgs, ... }:
    {
      users.users.jacob = {
        isNormalUser = true;
        description = "Jacob Alford";
        extraGroups = [
          "networkmanager"
          "wheel"
        ];
        openssh.authorizedPrincipals = authorizedPrincipals;
        openssh.authorizedKeys.keys = authorizedKeys;
        shell = pkgs.zsh;
      };
    };

  flake.modules.nixos.users-rae =
    { pkgs, ... }:
    {
      users.users.rae = {
        isNormalUser = true;
        description = "Rae Hill";
        extraGroups = [
          "networkmanager"
          "wheel"
        ];
        openssh.authorizedPrincipals = authorizedPrincipals;
        openssh.authorizedKeys.keys = authorizedKeys;
        shell = pkgs.zsh;
      };
    };

  flake.modules.nixos.users-admin =
    { pkgs, ... }:
    {
      users.users.admin = {
        isNormalUser = true;
        description = "Aedilis Administrator";
        extraGroups = [
          "networkmanager"
          "wheel"
        ];
        openssh.authorizedPrincipals = authorizedPrincipals;
        openssh.authorizedKeys.keys = authorizedKeys;
        shell = pkgs.zsh;
      };
    };

  # Aggregate: all human users, imported by every NixOS host.
  flake.modules.nixos.users-human = {
    imports = with inputs.self.modules.nixos; [
      users-jacob
      users-rae
      users-admin
    ];
  };
}
