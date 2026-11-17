{ config, ... }:
let
  c = config.constants;
in
{
  flake.modules.nixos.caddy =
    {
      pkgs-unstable,
      lib,
      config,
      ...
    }:
    {
      options.services.caddy.useInternalCA = lib.mkEnableOption "Use internal step-ca for ACME";

      config = {
        services.caddy = {
          package = pkgs-unstable.caddy;
          enable = true;
          email = lib.mkIf config.services.caddy.useInternalCA c.acme.email;
          acmeCA = lib.mkIf config.services.caddy.useInternalCA c.ca.acmeDirectoryHttp;
          logFormat = ''
            	output stdout
            	level INFO
            	format filter {
                wrap json

                request>headers>Authorization delete
                request>headers>Proxy-Authorization delete
                request>headers>WWW-Authenticate delete
                request>headers>Proxy-Authenticate delete
                request>headers>X-Api-Key delete
                request>headers>X-Auth-Token delete
                request>headers>X-Amz-Security-Token delete
                request>headers>X-Amz-Credential delete
                request>headers>X-Csrf-Token delete
                request>headers>Referer replace [REDACTED]  # may leak sensitive query params

                # --- Request cookies ---
                request>headers>Cookie cookie {
                  # Authentication & authorization
                  replace session [REDACTED]
                  replace session_id [REDACTED]
                  replace sessionid [REDACTED]
                  replace sid [REDACTED]
                  replace jsessionid [REDACTED]
                  replace phpsessid [REDACTED]
                  replace asp_session_id [REDACTED]
                  replace auth_session [REDACTED]
                  replace access_token [REDACTED]
                  replace token [REDACTED]
                  replace auth_token [REDACTED]
                  replace refresh_token [REDACTED]
                  replace id_token [REDACTED]
                  replace jwt [REDACTED]
                  replace api_key [REDACTED]
                  replace apikey [REDACTED]
                  replace secret [REDACTED]
                  replace client_secret [REDACTED]
                  replace password [REDACTED]
                  replace passwd [REDACTED]
                  replace pwd [REDACTED]
                  replace credentials [REDACTED]
                  replace remember_me [REDACTED]
                  replace remember_token [REDACTED]

                  # Session / CSRF / MFA
                  replace csrf_token [REDACTED]
                  replace csrftoken [REDACTED]
                  replace _csrf [REDACTED]
                  replace mfa_token [REDACTED]
                  replace otp [REDACTED]
                  replace totp [REDACTED]
                  replace nonce [REDACTED]
                  replace state [REDACTED]
                  replace code [REDACTED]
                  replace redirect_uri [REDACTED]
              }

              # --- Response headers ---
              response>headers>Set-Cookie delete
              response>headers>WWW-Authenticate delete
              response>headers>Proxy-Authenticate delete

              request>uri>query query {
                # Authentication & authorization
                replace access_token [REDACTED]
                replace token [REDACTED]
                replace auth_token [REDACTED]
                replace refresh_token [REDACTED]
                replace id_token [REDACTED]
                replace jwt [REDACTED]
                replace api_key [REDACTED]
                replace apikey [REDACTED]
                replace key [REDACTED]
                replace secret [REDACTED]
                replace client_secret [REDACTED]
                replace password [REDACTED]
                replace passwd [REDACTED]
                replace pwd [REDACTED]
                replace credentials [REDACTED]

                # Session identifiers
                replace session_id [REDACTED]
                replace sessionid [REDACTED]
                replace sid [REDACTED]
                replace jsessionid [REDACTED]
                replace asp_session_id [REDACTED]
                replace phpsessid [REDACTED]
                replace auth_session [REDACTED]

                # One-time codes / MFA
                replace otp [REDACTED]
                replace code [REDACTED]
                replace verification_code [REDACTED]
                replace pin [REDACTED]
                replace mfa_code [REDACTED]
                replace totp [REDACTED]
                replace nonce [REDACTED]

                # PII
                replace email [REDACTED]
                replace phone [REDACTED]
                replace mobile [REDACTED]
                replace ssn [REDACTED]
                replace social_security_number [REDACTED]
                replace dob [REDACTED]
                replace date_of_birth [REDACTED]
                replace name [REDACTED]
                replace first_name [REDACTED]
                replace last_name [REDACTED]
                replace address [REDACTED]
                replace zip [REDACTED]
                replace postal_code [REDACTED]
                replace ssn_last4 [REDACTED]

                # Payment data
                replace card_number [REDACTED]
                replace cc_number [REDACTED]
                replace pan [REDACTED]
                replace cvv [REDACTED]
                replace cvc [REDACTED]
                replace expiry_date [REDACTED]
                replace account_number [REDACTED]
                replace iban [REDACTED]
              }
            }
          '';
        };
      };
    };
}
