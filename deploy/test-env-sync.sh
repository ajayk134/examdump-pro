#!/usr/bin/env bash
#
# Tests for `redeploy-api.sh --sync-env`.
#
# WHY THIS EXISTS
# ---------------
# Environment injection is the step that failed silently in practice: a freshly
# added `UPI_SECRETS_KEY` sat in Doppler while deployments reported success,
# because `podman create --env-file` reads a FILE and never the shell that ran
# the script. The guard rails added for it are invisible until the day they are
# needed, so they are pinned down here.
#
# No production container, secret or network is touched. Every case runs against
# a throwaway env file in a temp directory.
#
# USAGE
#   ./test-env-sync.sh          # run all cases
#
# Requires: bash, coreutils, and podman with the postgres:16-alpine image already
# present (only for the round-trip case; it is skipped when unavailable). The
# image is the one this host already runs, so the test never needs the network.

set -Eeuo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/redeploy-api.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS=0
FAIL=0

pass() { printf '\033[1;32m  ok\033[0m %s\n' "$*"; PASS=$((PASS + 1)); }
fail() { printf '\033[1;31m  FAIL\033[0m %s\n' "$*" >&2; FAIL=$((FAIL + 1)); }

# Run a sync against a fresh env file. Values are given as inline assignments so
# each case is self-contained.
# A stand-in Doppler name list, so the tests neither read the real project nor
# depend on it being reachable. `--sync-env` only overlays variables that appear
# here, which is also the property that keeps a stray shell variable out.
ALLOW="${WORK}/allow.names"
cat >"${ALLOW}" <<'EOF'
LOG_LEVEL
PAYMENT_PROVIDER
UPI_SECRETS_KEY
NEW_SECRET
SUPERSECRET_TOKEN
EXISTING
ANCHOR
SPACED
EQUALS
HASHY
QUOTED
VALID
EOF

# `doppler` is stubbed to emit that list, so the real CLI is never consulted.
STUB_BIN="${WORK}/bin"
mkdir -p "${STUB_BIN}"
cat >"${STUB_BIN}/doppler" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *--only-names*) cat "${ALLOW}" ;;
  *) exit 0 ;;
esac
EOF
chmod +x "${STUB_BIN}/doppler"

run_sync() {
  local envout="${WORK}/out.log"
  # `env` is required here: an assignment prefix cannot precede an expanded
  # command (`"$@" bash ...`) in bash.
  env PATH="${STUB_BIN}:${PATH}" ENV_FILE="${TARGET}" "$@" \
    bash "${SCRIPT}" --sync-env >"${envout}" 2>&1
}

reset_env() {
  TARGET="${WORK}/api.env"
  printf '%s\n' "$@" >"${TARGET}"
}

has_line() { grep -qxF "$1" "${TARGET}"; }

printf "\033[1;34m==>\033[0m env sync tests\n"

# --- 1. Doppler writes values with surrounding quotes; podman keeps them -----
reset_env 'LOG_LEVEL="info"' 'PAYMENT_PROVIDER="hyperswitch"'
run_sync LOG_LEVEL='"info"' PAYMENT_PROVIDER='"hyperswitch"'
if has_line 'LOG_LEVEL=info' && has_line 'PAYMENT_PROVIDER=hyperswitch'; then
  pass "strips the quotes Doppler adds"
else
  fail "quotes survived: $(grep -E 'LOG_LEVEL|PAYMENT_PROVIDER' "${TARGET}" | tr '\n' ' ')"
fi

# --- 2. An empty incoming value must never blank a working one --------------
reset_env 'UPI_SECRETS_KEY=existing-key'
run_sync UPI_SECRETS_KEY=
if has_line 'UPI_SECRETS_KEY=existing-key'; then
  pass "refuses to blank an existing value"
else
  fail "existing value was lost: $(grep UPI_SECRETS_KEY "${TARGET:-}" 2>/dev/null || echo '<absent>')"
fi

# --- 3. A new variable is injected, existing ones survive -------------------
reset_env 'EXISTING=1'
run_sync EXISTING=1 NEW_SECRET=fresh-value
if has_line 'NEW_SECRET=fresh-value' && has_line 'EXISTING=1'; then
  pass "injects a new variable without dropping others"
else
  fail "new-variable injection incomplete"
fi

# --- 4. Spaces, '=' and '#' inside values survive ---------------------------
reset_env 'ANCHOR=1'
run_sync ANCHOR=1 SPACED='has spaces here' EQUALS='a=b=c' HASHY='abc#def'
if has_line 'SPACED=has spaces here' && has_line 'EQUALS=a=b=c' && has_line 'HASHY=abc#def'; then
  pass "preserves spaces and special characters"
else
  fail "special characters mangled"
fi

# --- 5. Rotation replaces the old value -------------------------------------
reset_env 'UPI_SECRETS_KEY=old-key'
run_sync UPI_SECRETS_KEY=new-key
if has_line 'UPI_SECRETS_KEY=new-key'; then
  pass "rotation overwrites the previous value"
else
  fail "rotation did not take effect"
fi

# --- 6. Secrets never reach stdout/stderr -----------------------------------
reset_env 'ANCHOR=1'
run_sync SUPERSECRET_TOKEN=topsecretvalue
if grep -q 'topsecretvalue' "${WORK}/out.log"; then
  fail "SECRET LEAKED into command output"
else
  pass "secret values never appear in output"
fi

# --- 6b. Variables outside the Doppler project are NOT copied in -----------
# A plain `env | grep -E '^[A-Z_]+='` would drag the whole shell - PATH,
# SSH_CLIENT, an unrelated MONGODB_URI - into the API container.
reset_env 'ANCHOR=1'
run_sync ANCHOR=1 SSH_CLIENT='10.0.0.1 1234 22' MONGODB_URI='mongodb://secret'
if has_line 'ANCHOR=1' && ! grep -q '^SSH_CLIENT=' "${TARGET}" && ! grep -q '^MONGODB_URI=' "${TARGET}"; then
  pass "ignores variables that are not in the Doppler project"
else
  fail "ambient shell variables leaked into the env file"
fi

# --- 7. The resulting file is not world-readable ----------------------------
reset_env 'ANCHOR=1'
chmod 644 "${TARGET}"
run_sync ANCHOR=1
if [[ "$(stat -c %a "${TARGET}")" == "600" ]]; then
  pass "env file is written 0600"
else
  fail "env file permissions are $(stat -c %a "${TARGET}"), expected 600"
fi

# --- 8. Comments, blank lines and malformed lines are dropped ---------------
reset_env '# a comment' '' 'NOEQUALS' 'VALID=1'
run_sync VALID=1
if has_line 'VALID=1' && ! grep -q 'NOEQUALS' "${TARGET}" && ! grep -q '^#' "${TARGET}"; then
  pass "ignores comments and malformed lines"
else
  fail "malformed input was not filtered"
fi

# --- 9. End-to-end: podman reads back exactly what we wrote -----------------
# This is the property that actually matters, and the one that was wrong.
if command -v podman >/dev/null 2>&1; then
  reset_env 'ANCHOR=1'
  run_sync ANCHOR=1 QUOTED='"info"' SPACED='has spaces here'
  podman_cmd=(podman)
  if [[ "${EUID}" -ne 0 ]]; then podman_cmd=(sudo podman); fi
  # stderr is kept so a genuine podman failure is reportable rather than
  # silently producing an empty string.
  readback="$("${podman_cmd[@]}" run --rm --entrypoint sh --env-file "${TARGET}" \
    docker.io/library/postgres:16-alpine -c 'printf "%s|%s|%s" "$QUOTED" "$SPACED" "$ANCHOR"' 2>&1 || true)"
  if [[ "${readback}" == 'info|has spaces here|1' ]]; then
    pass "podman reads back exactly the normalised values"
  elif [[ "${readback}" == *"not found"* || "${readback}" == *"unable to find"* ]]; then
    printf '\033[1;33m  skip\033[0m no usable local image; round-trip case not run\n'
  else
    fail "podman read back '${readback}', expected 'info|has spaces here|1'"
  fi
else
  printf '\033[1;33m  skip\033[0m podman not available; round-trip case not run\n'
fi

# ---------------------------------------------------------------------------
printf '\n%d passed, %d failed\n' "${PASS}" "${FAIL}"
[[ "${FAIL}" -eq 0 ]]
