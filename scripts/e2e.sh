#!/usr/bin/env bash
# Run the homelab e2e suite against a freshly BUNDLED homelab-server.
#
# Usage:
#   e2e [vitest-args...]                    # devshell command (wraps this script)
#   bash scripts/e2e.sh [vitest-args...]    # direct invocation
#
# - All arguments are passed through to `vitest run` (test-file path filters,
#   flags). No arguments = the full suite.
# - Bootstraps the machine-local server fixtures when missing (all freshly
#   generated, non-secret; see scripts/stage-e2e-secrets.mjs) so fresh
#   worktrees and CI runners work out of the box:
#   packages/homelab-server/.env-serve-test + private/{api-keys.json,jwk*,hmac-secret}
# - The bundled server's logs land in .e2e-log-dump.txt at the repo root
#   (gitignored) — read it when a test fails.
# - CHROME_EXECUTABLE (provided by the devshell) enables the live resume-print
#   success test; when it is unset (e.g. GitHub Actions) that test self-skips
#   and puppeteer never launches a browser.
set -muo pipefail

repo_root="$(git rev-parse --show-toplevel)" || {
  echo "ERROR: e2e must run inside the homelab git checkout" >&2
  exit 1
}
cd "${repo_root}" || exit 1

port="${E2E_PORT:-54328}"
origin="http://localhost:${port}"
log_dump=".e2e-log-dump.txt"
server_pid=""

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM
  if [[ -n "${server_pid}" ]] && kill -0 "${server_pid}" 2>/dev/null; then
    kill -TERM -- "-${server_pid}"
    wait "${server_pid}" 2>/dev/null || true
  fi
  exit "${exit_code}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Bootstrap generated test fixtures (idempotent; never overwrites existing files).
node scripts/stage-e2e-secrets.mjs || exit 1

export HOMELAB_ORIGIN_URL="${origin}"
export PORT="${port}"
export E2E_BASE_URL="${origin}"

# Mirror a CHROME_EXECUTABLE defined only in .env-serve-test into this shell, so
# the resume-print success test's skip gate sees the same chrome the server will.
if [[ -z "${CHROME_EXECUTABLE:-}" && -f packages/homelab-server/.env-serve-test ]]; then
  chrome_from_file="$(grep -E '^CHROME_EXECUTABLE=' packages/homelab-server/.env-serve-test | tail -n 1 | cut -d '=' -f 2-)"
  if [[ -n "${chrome_from_file}" ]]; then
    export CHROME_EXECUTABLE="${chrome_from_file}"
  fi
fi

echo "==> building homelab-server bundle"
yarn workspace homelab-server build || exit 1

export HOMELAB_COMMIT_HASH
HOMELAB_COMMIT_HASH="$(git rev-parse HEAD)"

echo "==> starting bundled server on ${origin} (logs: ${log_dump})"
yarn workspace homelab-server serve:test >"${log_dump}" 2>&1 &
server_pid=$!

healthy=""
for _ in {1..60}; do
  if curl -sf "${origin}/status/health" >/dev/null 2>&1; then
    healthy=1
    break
  fi
  if ! kill -0 "${server_pid}" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

if [[ -z "${healthy}" ]]; then
  echo "ERROR: server did not become healthy on ${origin}; last 60 log lines:" >&2
  tail -n 60 "${log_dump}" >&2 || true
  exit 1
fi

# Normalize path args pointing into the e2e workspace (absolute or repo-root
# relative, e.g. from lint-staged) to workspace-relative paths, because vitest
# matches CLI filters against paths relative to its root
# (packages/homelab-e2e-tests). Non-path args (flags like --exclude) and bare
# substrings (e.g. "status") pass through untouched.
vitest_args=()
for arg in "$@"; do
  case "${arg}" in
    -*) vitest_args+=("${arg}") ;;
    *) vitest_args+=("${arg##*packages/homelab-e2e-tests/}") ;;
  esac
done

echo "==> running e2e tests${vitest_args[*]:+ with vitest args: ${vitest_args[*]}}"
yarn workspace homelab-e2e-tests test:e2e ${vitest_args[@]+"${vitest_args[@]}"}
