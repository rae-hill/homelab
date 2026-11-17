{ inputs, ... }:
{
  # OpenRouter — gateway provider (native runtime + catalog; see
  # https://opencode.ai/docs/providers/#gateways). Keep the native package: it
  # preserves OpenRouter request/reasoning behavior and auto-lists the full
  # models.dev catalog; the explicit models below just pin the curated set.
  # The API key comes from the opencode per-service sops file
  # (secrets/nixos/opencode.yaml) — insert it with:
  #   sops nix-config/secrets/nixos/opencode.yaml   # add openrouter_api_key
  flake.modules.homeManager.opencode-providers-openrouter =
    { config, ... }:
    {
      sops.secrets.openrouter_api_key = {
        sopsFile = inputs.self + "/nix-config/secrets/nixos/opencode.yaml";
      };

      programs.opencode.settings.providers.openrouter = {
        name = "OpenRouter";
        package = "@opencode/ai/providers/openrouter";
        settings.apiKey = "{file:${config.sops.secrets.openrouter_api_key.path}}";

        models = {
          "openrouter/auto".name = "Auto Router";
          "openai/gpt-6.1-sol".name = "GPT-6.1 Sol";
          "anthropic/claude-sonnet-5.5".name = "Claude Sonnet 5.5";
          "google/gemini-4-argon".name = "Gemini 4 Argon";
          "qwen/qwen4-max".name = "Qwen4 Max";
          "qwen/qwen3.8-flash".name = "Qwen3.8 Flash";
          "qwen/qwen3.7-max".name = "Qwen3.7 Max";
          "qwen/qwen3.7-plus".name = "Qwen3.7 Plus";
          "qwen/qwen3.6-plus".name = "Qwen3.6 Plus";
          "qwen/qwen3.6-flash".name = "Qwen3.6 Flash";
          "deepseek/deepseek-v4-pro".name = "DeepSeek V4 Pro";
          "deepseek/deepseek-v4-pro-0813".name = "DeepSeek V4 Pro 0813";
          "deepseek/deepseek-v4-flash-0731".name = "DeepSeek V4 Flash 0731";
          "deepseek/deepseek-v4.1-flash".name = "DeepSeek V4.1 Flash";
          "deepseek/deepseek-v4.1-flash-1017".name = "DeepSeek V4.1 Flash 1017";
        };
      };
    };
}
