# resume-site — catalog entry: the built resume SPA served by Caddy on augustus
# at https://resume.plato-splunk.media (tailnet). Two purposes:
#   1. A browsable mirror of the GitHub Pages deployment (resume.rae-hill.dev).
#   2. The origin homelab-api's headless chrome renders POST /resume/print from
#      — no dependency on the public deployment, no URL-length limits (GH Pages
#      414s on real-world configs), no third-party egress surprises.
#
# The canonical static `file_server` case (same shape as homelab-ui): one Caddy
# vhost, a tailnet DNS record, and Caddy's shared managed cert. Chrome trusts
# the internal CA via security.pki.certificateFiles (alford-root) on the host.
{
  config,
  inputs,
  lib,
  ...
}:
let
  svc = config.constants.services.homelab;
  pkg = inputs.self.packages.x86_64-linux.resume-site;
in
{
  flake.modules.nixos.resume-site-catalog =
    { ... }:
    {
      homelab.catalog.resume-site = {
        # entry name "resume-site" so the tracing span reads `span resume-site`.
        subdomain = "resume"; # fqdn resume.plato-splunk.media == svc.resumeSiteUrl
        host = "augustus";

        backend.static.root = pkg; # root * <store path> + Cache-Control header + file_server

        # CSR SPA: deep links (e.g. /oauth-callback) fall back to index.html.
        extraCaddyConfig = ''
          try_files {path} /index.html
        '';

        tls.cert.shared = { }; # shares Caddy's managed cert; no ACME cert / challenge vhost
        tracing.enable = true; # `tracing { span resume-site }` when the host runs Tempo
        access.scope.tailnet = { }; # tailnet-only mirror; the PUBLIC site stays resume.rae-hill.dev
        dns.tailnet = { }; # emit resume A/AAAA on aedilis (see service-registry catalogDns)

        # No oidc (static SPA, same as homelab-ui).
        managedBy = {
          caddy = true;
          firewall = true;
          dns = true;
        };
      };

      # The PDF print service renders from this origin instead of the public
      # GitHub Pages deployment. mkDefault so a host-level override still wins.
      services.homelab-api.resumeSiteUrl = lib.mkDefault svc.resumeSiteUrl;
    };
}
