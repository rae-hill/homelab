# System/service users. Each service module imports its own user module (see
# the `imports` in desktop-restic, networking-radius, apps-home-assistant,
# apps-planka, ai-openwebui), so any host running the service also gets the
# user with the pinned uid/gid (preserved from the former augustus/users.nix).
# The homelab-api user/group is declared by homelab-api/systemd-service.nix
# itself (uid 26697 / gid 26696 defaults) and needs no entry here.
{ inputs, ... }:
{
  flake.modules.nixos.users-restic =
    { ... }:
    {
      users.users.restic = {
        isNormalUser = true;
      };
    };

  flake.modules.nixos.users-radiusd =
    { ... }:
    {
      users.groups.radiusd = {
        gid = 222;
      };
      users.users.radiusd = {
        isSystemUser = true;
        group = "radiusd";
        uid = 222;
      };
    };

  flake.modules.nixos.users-hass =
    { config, ... }:
    {
      users.groups.hass = {
        gid = config.ids.gids.hass;
      };
      users.users.hass = {
        home = "/var/lib/hass";
        createHome = true;
        group = "hass";
        uid = config.ids.uids.hass;
      };
    };

  flake.modules.nixos.users-planka =
    { ... }:
    {
      users.groups = {
        planka = {
          gid = 10666;
        };
        planka-certs = {
          gid = 11666;
        };
        planka-db-pass = {
          gid = 12666;
        };
      };
      users.users.planka = {
        isSystemUser = true;
        home = "/var/lib/planka";
        group = "planka";
        uid = 10666;
      };
    };

  flake.modules.nixos.users-openwebui =
    { ... }:
    {
      users.groups.openwebui = {
        gid = 47955;
      };
      users.users.openwebui = {
        isSystemUser = true;
        home = "/var/lib/open-webui";
        group = "openwebui";
        uid = 48955;
      };
    };
}
