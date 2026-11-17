{
  # All secret declarations live in the service/host modules that consume them,
  # each pointing at a module-local sops file (secrets/<host>.yaml under the
  # module dir; host-specific ones under system-configs/augustus/secrets/).
  # See the index in each module and docs/secretspec-migration-plan.md.
  # Only the age identity stays host-local.
  sops.age.keyFile = "/home/jacob/.config/sops/age/keys.txt";
}
