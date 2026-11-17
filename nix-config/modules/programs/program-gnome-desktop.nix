{
  flake.modules.nixos.gnome-desktop =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      services.desktopManager.gnome = {
        enable = true;
      };

      services.displayManager.gdm = {
        enable = true;
      };

      services.gnome.gcr-ssh-agent.enable = false;

      services.printing.enable = true;

      services.pulseaudio.enable = false;

      services.avahi = {
        enable = true;
        nssmdns4 = true;
        openFirewall = true;
      };

      services.xserver.xkb = {
        layout = "us";
        variant = "";
      };

      services.pipewire = {
        enable = true;
        alsa.enable = true;
        alsa.support32Bit = true;
        pulse.enable = true;
      };
    };
}
