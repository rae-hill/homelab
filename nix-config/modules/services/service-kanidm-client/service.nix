{ config, ... }:
let
  c = config.constants;
  unix = c.unix;
in
{
  # Kanidm unix CLIENT: NSS + PAM integration via kanidm-unixd. Enabling
  # `services.kanidm.unix.enable` in nixpkgs 26.05 AUTO-WIRES the pam_kanidm
  # rules (auth/account/session, sufficient, ignore_unknown_user) — do NOT
  # hand-write security.pam.services.*.rules.
  #
  # SSH: `unix.sshIntegration` is deliberately DISABLED. It would install an
  # AuthorizedKeysCommand that serves long-lived STATIC Kanidm-managed public
  # keys. We intentionally rely solely on step-ca instead, which issues
  # SHORT-LIVED SSH CERTIFICATES (via the `kanidm` OIDC provisioner) validated
  # by services.openssh.settings.TrustedUserCAKeys — a stronger, expiring
  # credential. Keeping both would add a weaker parallel auth path and a second
  # AuthorizedKeysCommand for no benefit. Audit after deploy with:
  #   sshd -T | grep -iE 'authorizedkeys|trustedusercakeys'
  # (expect: NO kanidm AuthorizedKeysCommand, TrustedUserCAKeys intact.)
  flake.modules.nixos.kanidm-client =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.kanidm = {
        # Client package must match the server major (augustus uses _1_11).
        package = lib.mkDefault pkgs.kanidmWithSecretProvisioning_1_11;

        client.enable = true;
        client.settings.uri = c.idm.url;

        unix.enable = true; # NSS + PAM (auto-wired) + unixd-tasks (home creation)
        # Disabled on purpose — step-ca short-lived SSH certs are the sole SSH
        # auth path (see header comment). Leaving this false removes the
        # AuthorizedKeysCommand, the kanidm_ssh_authorizedkeys wrapper, and the
        # kanidm-authorized-keys user.
        unix.sshIntegration = false;

        unix.settings = {
          # Human-friendly home path: /home/<name> (e.g. /home/rae) rather than
          # the default /home/<spn> (/home/rae@idm.plato-splunk.media). The real
          # directory is UUID-keyed with a symlink; "name" makes the symlink the
          # bare login name, which Phase 2's home.homeDirectory will point at.
          home_alias = "name";

          kanidm = {
            # Login gate: a user must be a member of one of these POSIX groups
            # to authenticate via PAM. NSS resolution works regardless.
            pam_allowed_login_groups = [ unix.groups.workstations.name ];

            # Extend local system groups with Kanidm POSIX group membership.
            # (Nix: `with` is a reserved keyword, so it must be quoted.)
            map_group = [
              {
                local = "wheel";
                "with" = unix.groups.sysadmins.name;
              }
              {
                local = "networkmanager";
                "with" = unix.groups.workstations.name;
              }
              {
                local = "video";
                "with" = unix.groups.workstations.name;
              }
            ];
          };
        };
      };

      # Local system groups that map_group targets must exist locally.
      users.groups.wheel = { };
      users.groups.networkmanager = { };
      users.groups.video = { };
    };
}
