{ inputs, ... }:
{
  flake.modules.homeManager.opencode-providers-alibaba =
    {
      config,
      pkgs,
      pkgs-unstable,
      ...
    }:
    {
      # QwenCloud token-plan key from the opencode per-service sops file
      # (secrets/nixos/opencode.yaml — declared here, decrypted with the HM
      # sops age keyFile of whichever home config wires opencode).
      sops.secrets.qwen_openai_key = {
        sopsFile = inputs.self + "/nix-config/secrets/nixos/opencode.yaml";
      };

      programs.opencode.settings.providers = {
        "qwencloud-token-plan-personal" = {
          name = "QwenCloud";
          package = "@opencode/ai/providers/anthropic-compatible";
          settings = {
            baseURL = "https://token-plan.maas.qwencloudapi.com/apps/anthropic/v1";
            apiKey = "{file:${config.sops.secrets.qwen_openai_key.path}}";
          };

          models = {
            auto = {
              name = "Auto";
              capabilities = {
                input = [ "text" ];
                output = [ "text" ];
              };
            };

            "qwen3.8-max" = {
              name = "Qwen3.8 Max";
              limit = {
                context = 983616;
                output = 131072;
              };
              capabilities = {
                input = [
                  "text"
                  "image"
                ];
                output = [ "text" ];
                reasoning.supported = true;
              };
              # was V1 `options.effort = "xhigh"`
              body.effort = "xhigh";
            };

            "qwen3.8-flash" = {
              name = "Qwen3.8 Flash";
              limit = {
                context = 983616;
                output = 131072;
              };
              capabilities = {
                input = [
                  "text"
                  "image"
                ];
                output = [ "text" ];
                reasoning.supported = true;
              };
              body.effort = "xhigh";
            };

            "qwen3.7-max" = {
              name = "Qwen3.7 Max";
              capabilities.reasoning.supported = true;
              body.thinking = {
                type = "enabled";
                budget_tokens = 8192;
              };
            };

            "qwen3.7-plus" = {
              name = "Qwen3.7 Plus";
              capabilities = {
                input = [
                  "text"
                  "image"
                ];
                output = [ "text" ];
                reasoning.supported = true;
              };
              body.thinking = {
                type = "enabled";
                budget_tokens = 8192;
              };
            };

            "qwen3.6-plus" = {
              name = "Qwen3.6 Plus";
              capabilities = {
                input = [
                  "text"
                  "image"
                ];
                output = [ "text" ];
                reasoning.supported = true;
              };
              body.thinking = {
                type = "enabled";
                budget_tokens = 8192;
              };
            };

            "qwen3.6-flash" = {
              name = "Qwen3.6 Flash";
              capabilities = {
                input = [
                  "text"
                  "image"
                ];
                output = [ "text" ];
                reasoning.supported = true;
              };
              body.thinking = {
                type = "enabled";
                budget_tokens = 8192;
              };
            };

            "glm-5.3" = {
              name = "GLM-5.3";
              capabilities.reasoning.supported = true;
              body.thinking = {
                type = "enabled";
                budget_tokens = 8192;
              };
            };

            "glm-5.2" = {
              name = "GLM-5.2";
              capabilities.reasoning.supported = true;
              body.thinking = {
                type = "enabled";
                budget_tokens = 8192;
              };
            };

            "deepseek-v4-pro" = {
              name = "DeepSeek V4 Pro";
            };

            "deepseek-v4-pro-0813" = {
              name = "DeepSeek V4 Pro 0813";
            };

            "deepseek-v4-flash-0731" = {
              name = "DeepSeek V4 Flash 0731";
            };

            "deepseek-v4.1-flash" = {
              name = "DeepSeek V4.1 Flash";
            };

            "deepseek-v4.1-flash-1017" = {
              name = "DeepSeek V4.1 Flash 1017";
            };
          };
        };
      };
    };
}
