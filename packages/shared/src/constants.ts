export const BASE_KEY = "plato-splunk.services.homelab-api"

/**
 * The kanidm claim-map role (and homelab-server resource URI) required to print resumes
 * via `POST /resume/print`. Provisioned by the `resume.printing` kanidm group
 * (nix-config/modules/features/homelab-api/oidc.nix → claimMaps.roles).
 */
export const RESUME_PRINT_ROLE = "Resume_Print"

/**
 * The kanidm claim-map role (and homelab-server resource URI) required to tailor resumes
 * via `POST /resume/tailor`. Granted by the `resume.printing` kanidm group's claim map
 * (nix-config/modules/features/homelab-api/oidc.nix → claimMaps.roles, Option A per doc 05 §5).
 */
export const RESUME_TAILOR_ROLE = "Resume_Tailor"

export const JWT_ROLES_KEY = "roles"

export const JWT_HOMELAB_API_AUD = `homelab`

export const JWT_HOMELAB_API_ISSUER = `https://homelab.plato-splunk.media`

export const JWT_HOMELAB_API_TESTING_ISSUER = `https://homelab-local.plato-splunk.media`

export const ONE_HOUR_SECONDS = 3600

export const FIVE_MINUTES_SECONDS = 60 * 5

export const MS_PER_S = 1000
