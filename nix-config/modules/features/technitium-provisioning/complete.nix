{ inputs, ... }:
{
  # Aggregate for the API-driven Technitium provisioning feature. Imports the option
  # schema + each provisioning unit (token broker socket, settings, encrypted-dns,
  # records) and defines the convenience target that ties the stack together. Hosts
  # import this feature in addition to the server-only `technitium` feature.
  #
  # NOTE: the provisioning account (provision.apiUser) and the Prometheus metrics user
  # are created MANUALLY (see docs/aedilis-deployment-runbook.md) — this module no
  # longer creates users/groups, so it needs only a least-privilege apiUser with
  # Settings:Modify + Zones:Modify (no Administration).
  flake.modules.nixos.technitium-provisioning = {
    imports =
      (with inputs.self.modules.nixos; [
        technitium-provisioning-options
        technitium-provisioning-token
        technitium-provisioning-settings
        technitium-provisioning-encrypted-dns
        technitium-provisioning-records
      ])
      ++ [
        (
          { config, lib, ... }:
          let
            cfg = config.services.technitium-server-complete;
          in
          {
            config = lib.mkIf (cfg.enable && cfg.provision.enable) {
              # One handle for the whole provisioning stack. Each enabled sub-unit
              # declares `wantedBy = [ "technitium-provision.target" ]`, so this target
              # pulls them in at boot. `systemctl status technitium-provision.target`
              # summarises the stack.
              systemd.targets.technitium-provision = {
                description = "Technitium provisioning stack";
                wantedBy = [ "multi-user.target" ];
              };
            };
          }
        )
      ];
  };
}
