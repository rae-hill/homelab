# ACME cert generator (nixos only).
#
# Reads the whole catalog; filters to entries on THIS host with managedBy.acme AND
# tls.ca != null (the common tls.ca == null reverse-proxy case shares Caddy's managed cert
# and emits nothing). Emits security.acme.certs.<fqdn> + the matching http://<fqdn> challenge
# vhost. See docs/service-consolidation/catalog-and-generators.md §3.4.
{ config, ... }@topLevel:
let
  c = topLevel.config.constants;
  catLib = c.catalogLib;
in
{
  flake.modules.nixos.homelab-service-acme =
    { config, lib, ... }:
    let
      mine = lib.filterAttrs (
        _: e: e.host == config.networking.hostName && e.managedBy.acme && e.tls.ca != null
      ) config.homelab.catalog;

      certServer =
        e:
        if e.tls.ca == "letsencrypt" then
          "https://acme-v02.api.letsencrypt.org/directory"
        else
          c.ca.acmeDirectoryHttp; # internal step-ca

      mkCert =
        name: e:
        lib.nameValuePair (catLib.fqdn e) (
          {
            domain = catLib.fqdn e;
            listenHTTP = "127.0.0.1:${toString e.tls.acmePort}";
            server = certServer e;
            group = e.tls.certGroup;
            reloadServices = lib.optionals e.tls.reloadCaddy [ "caddy.service" ] ++ e.tls.reloadServices;
          }
          // lib.optionalAttrs (e.tls.email != null) { email = e.tls.email; }
          // lib.optionalAttrs (e.tls.postRun != null) { postRun = e.tls.postRun; }
        );

      # The :80 challenge vhost. Only needed for via == "caddy80" (direct challenges reach the
      # loopback acmePort straight from the ACME server over the firewall-opened port).
      challengeBody =
        e:
        if e.tls.challenge.body == "bare" then
          "reverse_proxy 127.0.0.1:${toString e.tls.acmePort}\n"
        else
          ''
            handle /.well-known/acme-challenge/* {
              reverse_proxy 127.0.0.1:${toString e.tls.acmePort}
            }
          ''
          + lib.optionalString e.tls.challenge.redirectToHttps ''
            handle {
              redir https://${catLib.fqdn e}{uri}
            }
          '';

      mkChallengeVhost =
        name: e: lib.nameValuePair "http://${catLib.fqdn e}" { extraConfig = challengeBody e; };

      caddy80 = lib.filterAttrs (_: e: e.tls.challenge.via == "caddy80") mine;
    in
    {
      security.acme.certs = lib.mapAttrs' mkCert mine;
      services.caddy.virtualHosts = lib.mapAttrs' mkChallengeVhost caddy80;
    };
}
