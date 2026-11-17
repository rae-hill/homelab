let
  module =
    { ... }:
    {
      programs.nixvim.plugins.lint = {
        enable = true;
        lintersByFt = {
          text = [ "vale" ];
          markdown = [ "vale" ];
          rst = [ "vale" ];
          ruby = [ "ruby" ];
          dockerfile = [ "hadolint" ];
          terraform = [ "tflint" ];
        };
      };
    };
in
{
  flake.modules.homeManager.nixvim-lint = module;
  flake.modules.darwin.nixvim-lint = module;
}
