{ inputs, ... }:
{
  flake.modules.homeManager.games-mangohud =
    { inputs, ... }:
    {
      programs.mangohud = {
        enable = true;
        settings = {
          gpu_temp = true;
          gpu_core_clock = true;
          gpu_load_value = true;
          gpu_fan = true;
          cpu_temp = true;
          cpu_mhz = true;
          cpu_load_value = true;
        };
      };
    };
}
