# ACME cert generator (nixos only).
#
# Reads the whole catalog; filters to entries on THIS host with managedBy.acme AND
# tls.cert == { own = …; } (the common shared-cert reverse-proxy case shares Caddy's managed
# cert and emits nothing). Emits security.acme.certs.<fqdn> + the matching http://<fqdn>
# challenge vhost. See docs/service-consolidation/catalog-and-generators.md §3.4.
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
        _: e: e.host == config.networking.hostName && e.managedBy.acme && catLib.tagOf e.tls.cert == "own"
      ) config.homelab.catalog;

      certServer =
        own:
        if own.ca == "letsencrypt" then
          "https://acme-v02.api.letsencrypt.org/directory"
        else
          c.ca.acmeDirectoryHttp; # internal step-ca

      mkCert =
        name: e:
        let
          own = e.tls.cert.own;
        in
        lib.nameValuePair (catLib.fqdn e) (
          {
            domain = catLib.fqdn e;
            listenHTTP = "127.0.0.1:${toString own.acmePort}";
            server = certServer own;
            group = own.certGroup;
            reloadServices = lib.optionals own.reloadCaddy [ "caddy.service" ] ++ own.reloadServices;
          }
          // lib.optionalAttrs (own.email != null) { email = own.email; }
          // lib.optionalAttrs (own.postRun != null) { postRun = own.postRun; }
        );

      # The :80 challenge vhost. Only needed for via == "caddy80" (direct challenges reach the
      # loopback acmePort straight from the ACME server over the firewall-opened port).
      challengeBody =
        e:
        let
          own = e.tls.cert.own;
          body = own.challenge.body;
        in
        if catLib.tagOf body == "bare" then
          "reverse_proxy 127.0.0.1:${toString own.acmePort}\n"
        else
          ''
            handle /.well-known/acme-challenge/* {
              reverse_proxy 127.0.0.1:${toString own.acmePort}
            }
          ''
          + lib.optionalString body.handle.redirectToHttps ''
            handle {
              redir https://${catLib.fqdn e}{uri}
            }
          '';

      mkChallengeVhost =
        name: e: lib.nameValuePair "http://${catLib.fqdn e}" { extraConfig = challengeBody e; };

      caddy80 = lib.filterAttrs (_: e: e.tls.cert.own.challenge.via == "caddy80") mine;
    in
    {
      security.acme.certs = lib.mapAttrs' mkCert mine;
      services.caddy.virtualHosts = lib.mapAttrs' mkChallengeVhost caddy80;
    };
}
