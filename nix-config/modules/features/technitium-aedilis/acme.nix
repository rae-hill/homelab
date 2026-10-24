{ config, inputs, ... }:
{
  # Host-level ACME base for aedilis's Technitium deployment. The three certs + their HTTP-01
  # challenge vhosts (public LE dns cert, step-ca admin + metrics certs) now come from the
  # service catalog (features/technitium-aedilis/catalog.nix, rendered by the acme generator).
  # This module keeps only the `acme` base import + the default CA selection (per-cert server/
  # listenHTTP are set explicitly by the generator, so the defaults only cover acceptTerms/email).
  flake.modules.nixos.technitium-aedilis-acme =
    { ... }:
    {
      imports = [ inputs.self.modules.nixos.acme ];

      # Default to internal step-ca; the public DNS cert overrides to Let's Encrypt per-cert.
      services.homelab-acme.defaultCA = "internal";
    };
}
