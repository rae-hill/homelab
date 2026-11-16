{
  config,
  inputs,
  lib,
  ...
}:
let
  allow = action: resource: {
    inherit action resource;
    effect = "allow";
  };
  ask = action: resource: {
    inherit action resource;
    effect = "ask";
  };
  deny = action: resource: {
    inherit action resource;
    effect = "deny";
  };

  allowShellCmd = map (cmd: allow "shell" "${cmd} *");

  allowRepoEdit = allow "edit" "*";
  askExternalDir = ask "external_directory" "*";
  askWebfetch = ask "webfetch" "*";
  askShell = ask "shell" "*";
  denySops = deny "shell" "sops *";
  denySudo = deny "shell" "sudo *";
  allowShellPrograms = allowShellCmd [
    # read-only inspection
    "cat"
    "cut"
    "date"
    "df"
    "diff"
    "du"
    "echo"
    "fd"
    "file"
    "find"
    "grep"
    "head"
    "hostname"
    "jq"
    "ls"
    "ps"
    "pwd"
    "rg"
    "sort"
    "stat"
    "tail"
    "tr"
    "tree"
    "uname"
    "uniq"
    "wc"
    "which"
    # non-destructive file ops (rm/chmod/chown still ask)
    "cp"
    "ln"
    "mkdir"
    "mv"
    "touch"
    # git inspection + the repo's agent commit convention
    # (plain `git commit`/`git push` still ask)
    "git add"
    "git branch"
    "git commit --no-verify"
    "git diff"
    "git fetch"
    "git log"
    "git show"
    "git stash list"
    "git status"
    # nix / node / devshell project tooling
    "dprint check"
    "dprint fmt"
    "nix build"
    "nix develop"
    "nix eval"
    "nix flake check"
    "nix flake metadata"
    "nix fmt"
    "nix run"
    "nixos-rebuild"
    "update-missing-hashes"
    "yarn"
  ];
in
{
  flake.modules.homeManager.opencode-permissions =
    { ... }:
    {
      programs.opencode.settings.permissions = [
        allowRepoEdit
        allowShellPrograms

        askExternalDir
        askShell
        askWebfetch

        denySops
        denySudo
      ];
    };
}
