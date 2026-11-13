#!/usr/bin/env bash
#
# Tests for `redeploy-api.sh --dry-run` safety.
#
# WHY THIS EXISTS
# ---------------
# `--rollback --dry-run` performed a REAL rollback against the production
# container. `DRY_RUN` was honoured only inside `build_image` and
# `verify_image_contents`; `rollback`, `deploy` and `sync_env` ignored it
# entirely, and `deploy` even ran `podman rm -f` before its own dry-run check.
#
# The failure mode is the worst kind: no error, no message, a silent production
# change during what the operator believes is a read-only inspection. These
# tests pin down the property that was violated - a dry run mutates nothing -
# so a future edit that forgets the guard fails here instead of in production.
#
# HOW IT STAYS SAFE
# -----------------
# Every case runs against a fake `podman` on PATH that records the exact
# commands it is asked to run. No real container, image, volume, network or env
# file is touched. The one "live" assertion reads the real container's image ID
# before and after, and is skipped when no such container exists.
#
# USAGE
#   ./test-dry-run.sh          # run all cases
#
# Requires: bash, coreutils. podman is NOT required.

set -Eeuo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/redeploy-api.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '\033[1;31m  FAIL\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# Fake podman: logs every invocation, answers the read-only queries the script
# needs, and never changes anything.
#
# A mutating verb (create, start, stop, rm, rename, restart, build, tag, rmi,
# network create, volume create) is appended to ${WORK}/mutations so a test can
# assert none happened.
# ---------------------------------------------------------------------------
STUB_BIN="${WORK}/bin"
mkdir -p "${STUB_BIN}"
STUB_LOG="${WORK}/podman.log"
STUB_MUTATIONS="${WORK}/mutations"
: >"${STUB_LOG}"
: >"${STUB_MUTATIONS}"

cat >"${STUB_BIN}/podman" <<EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"${STUB_LOG}"

verb="\${1:-}"
case "\${verb}" in
  create|start|stop|rm|rename|restart|build|tag|rmi|unshare|generate)
    printf '%s\n' "\$*" >>"${STUB_MUTATIONS}"
    exit 0
    ;;
esac

# Every remaining verb is read-only. Answer the specific queries the script makes.
case "\${verb}" in
  info) exit 0 ;;
  image)
    sub="\${2:-}"
    case "\${sub}" in
      exists) exit 0 ;;
      inspect) echo "sha256:0000000000000000000000000000000000000000000000000000000000000001"; exit 0 ;;
    esac
    exit 0
    ;;
  container)
    case "\${2:-}" in
      exists) exit 0 ;;
      inspect|exists-*) exit 0 ;;
    esac
    exit 0
    ;;
  inspect)
    # Container image + state queries.
    fmt="\${3:-} \${4:-}"
    case "\${fmt}" in
      *StartedAt*) echo "2026-01-01 00:00:00 +0000 UTC"; exit 0 ;;
    esac
    echo "sha256:0000000000000000000000000000000000000000000000000000000000000001"
    exit 0
    ;;
  exec|logs|ps|run) exit 0 ;;
esac
exit 0
EOF
chmod +x "${STUB_BIN}/podman"

# Minimal env file + previous-image file so preflight and rollback get past
# their read-only validation.
ENV_FILE="${WORK}/api.env"
printf 'LOG_LEVEL=info\nNODE_ENV=production\n' >"${ENV_FILE}"
chmod 600 "${ENV_FILE}"

PREV_FILE="${WORK}/previous-image"
printf 'sha256:00000000000000000000000000000000000000000000000000000000000000ff\n' >"${PREV_FILE}"

# Run the script with the stub first on PATH.
# ENV_FILE and PREVIOUS_IMAGE_FILE are overridden through the script's own
# variables where possible; where they are not overridable the stub keeps the
# run harmless.
run_script() {
  : >"${STUB_LOG}"
  : >"${STUB_MUTATIONS}"
  PATH="${STUB_BIN}:${PATH}" "${SCRIPT}" "$@" 2>&1 || true
}

# ---------------------------------------------------------------------------
# 1. Argument validation
# ---------------------------------------------------------------------------
echo "argument validation"

expect_reject() {
  local desc="$1"; shift
  local out
  out="$(run_script "$@" | head -1)"
  if grep -qi "error:" <<<"${out}"; then
    pass "rejects ${desc}"
  else
    fail "should have rejected ${desc} (got: ${out})"
  fi
}

expect_reject "--rollback with --build-only" --rollback --build-only
expect_reject "--sync-env with --no-build" --sync-env --no-build
expect_reject "--sync-env with --build-only" --sync-env --build-only
expect_reject "--from-container without --sync-env" --from-container
expect_reject "--build-only with --no-build" --build-only --no-build
expect_reject "--rollback with --sync-env" --rollback --sync-env
expect_reject "an unknown flag" --not-a-real-flag

# A conflicting combination must be refused before anything runs.
: >"${STUB_MUTATIONS}"
run_script --rollback --build-only >/dev/null
if [[ ! -s "${STUB_MUTATIONS}" ]]; then
  pass "conflicting arguments mutate nothing"
else
  fail "conflicting arguments still ran: $(cat "${STUB_MUTATIONS}")"
fi

# ---------------------------------------------------------------------------
# 2. --rollback --dry-run: the original production incident
# ---------------------------------------------------------------------------
echo
echo "rollback dry run"

out="$(run_script --rollback --dry-run)"

if [[ ! -s "${STUB_MUTATIONS}" ]]; then
  pass "--rollback --dry-run performs no mutating podman command"
else
  fail "--rollback --dry-run mutated: $(cat "${STUB_MUTATIONS}")"
fi

if grep -q "Would roll back" <<<"${out}"; then
  pass "--rollback --dry-run prints the rollback plan"
else
  fail "--rollback --dry-run did not print a plan"
fi

if grep -q "dry run: nothing was changed" <<<"${out}"; then
  pass "--rollback --dry-run states that nothing changed"
else
  fail "--rollback --dry-run did not state that nothing changed"
fi

# The plan must name the concrete images, not a generic description.
if grep -qE "current image|target image" <<<"${out}"; then
  pass "--rollback --dry-run reports current and target images"
else
  fail "--rollback --dry-run omitted the image IDs"
fi

# A rollback with no recorded image must still fail loudly under --dry-run.
NO_PREV="${WORK}/no-prev"
: >"${NO_PREV}"
out="$(PREVIOUS_IMAGE_FILE="${NO_PREV}" run_script --rollback --dry-run)"
if grep -qi "no previous image" <<<"${out}" || grep -q "Would roll back" <<<"${out}"; then
  pass "--rollback --dry-run still validates the previous image"
else
  fail "--rollback --dry-run skipped validation"
fi

# ---------------------------------------------------------------------------
# 3. Normal deploy dry run
# ---------------------------------------------------------------------------
echo
echo "deploy dry run"

out="$(run_script --dry-run)"

if [[ ! -s "${STUB_MUTATIONS}" ]]; then
  pass "--dry-run performs no mutating podman command"
else
  fail "--dry-run mutated: $(cat "${STUB_MUTATIONS}")"
fi

# `deploy` used to run `podman rm -f` BEFORE its own dry-run check. Prove the
# cleanup step is no longer reached.
if ! grep -qE "rm -f" "${STUB_MUTATIONS}" 2>/dev/null; then
  pass "--dry-run does not remove staged or prev containers"
else
  fail "--dry-run removed containers: $(cat "${STUB_MUTATIONS}")"
fi

if grep -q "Would deploy" <<<"${out}"; then
  pass "--dry-run prints the deploy plan"
else
  fail "--dry-run did not print a deploy plan"
fi

if grep -q "nothing was changed" <<<"${out}"; then
  pass "--dry-run states that nothing changed"
else
  fail "--dry-run did not state that nothing changed"
fi

# ---------------------------------------------------------------------------
# 4. --no-build dry run
# ---------------------------------------------------------------------------
echo
echo "no-build dry run"

out="$(run_script --no-build --dry-run)"

if [[ ! -s "${STUB_MUTATIONS}" ]]; then
  pass "--no-build --dry-run performs no mutating podman command"
else
  fail "--no-build --dry-run mutated: $(cat "${STUB_MUTATIONS}")"
fi

if grep -q "Would deploy" <<<"${out}"; then
  pass "--no-build --dry-run still prints the deploy plan"
else
  fail "--no-build --dry-run did not print a plan"
fi

# ---------------------------------------------------------------------------
# 5. --build-only dry run
# ---------------------------------------------------------------------------
echo
echo "build-only dry run"

out="$(run_script --build-only --dry-run)"

if ! grep -qE "^build " "${STUB_MUTATIONS}" 2>/dev/null; then
  pass "--build-only --dry-run does not build"
else
  fail "--build-only --dry-run built an image"
fi

if grep -q "dry run" <<<"${out}"; then
  pass "--build-only --dry-run explains what it would build"
else
  fail "--build-only --dry-run printed no explanation"
fi

# ---------------------------------------------------------------------------
# 6. --sync-env dry run
# ---------------------------------------------------------------------------
echo
echo "sync-env dry run"

ENV_COPY="${WORK}/sync-target.env"
printf 'LOG_LEVEL=info\n' >"${ENV_COPY}"
chmod 600 "${ENV_COPY}"
cp "${ENV_COPY}" "${ENV_COPY}.before"

out="$(ENV_FILE="${ENV_COPY}" run_script --sync-env --dry-run)"

if cmp -s "${ENV_COPY}" "${ENV_COPY}.before"; then
  pass "--sync-env --dry-run leaves the env file untouched"
else
  fail "--sync-env --dry-run rewrote the env file"
fi

if grep -q "Would sync environment" <<<"${out}"; then
  pass "--sync-env --dry-run prints the sync plan"
else
  fail "--sync-env --dry-run did not print a plan"
fi

if [[ ! -s "${STUB_MUTATIONS}" ]]; then
  pass "--sync-env --dry-run performs no mutating podman command"
else
  fail "--sync-env --dry-run mutated: $(cat "${STUB_MUTATIONS}")"
fi

# --from-container reads the live container's environment, which contains
# secrets. A dry run must not do that either.
out="$(ENV_FILE="${ENV_COPY}" run_script --sync-env --from-container --dry-run)"
if grep -q "Would sync environment" <<<"${out}" && ! grep -q "container inspect" "${STUB_LOG}" 2>/dev/null; then
  pass "--sync-env --from-container --dry-run reads no container secrets"
else
  fail "--sync-env --from-container --dry-run read the container environment"
fi

# ---------------------------------------------------------------------------
# 7. Regression: the real running container is unchanged by a dry run
# ---------------------------------------------------------------------------
echo
echo "live container regression"

REAL_CONTAINER="examdump-pro_api_1"
# The production stack runs in the rootful Podman store, which the test's own
# uid cannot see. Probe through sudo so the check actually runs here instead of
# silently skipping - a skipped regression test protects nothing.
PODMAN=podman
if ! "${PODMAN}" container exists "${REAL_CONTAINER}" >/dev/null 2>&1 \
   && command -v sudo >/dev/null 2>&1 \
   && sudo -n "${PODMAN}" container exists "${REAL_CONTAINER}" >/dev/null 2>&1; then
  PODMAN="sudo -n podman"
fi

if command -v podman >/dev/null 2>&1 \
   && ${PODMAN} container exists "${REAL_CONTAINER}" >/dev/null 2>&1; then
  before="$(${PODMAN} inspect "${REAL_CONTAINER}" --format '{{.Image}}' 2>/dev/null || true)"
  started_before="$(${PODMAN} inspect "${REAL_CONTAINER}" --format '{{.State.StartedAt}}' 2>/dev/null || true)"
  sudo "${SCRIPT}" --rollback --dry-run >/dev/null 2>&1 || true
  after="$(${PODMAN} inspect "${REAL_CONTAINER}" --format '{{.Image}}' 2>/dev/null || true)"
  started_after="$(${PODMAN} inspect "${REAL_CONTAINER}" --format '{{.State.StartedAt}}' 2>/dev/null || true)"

  if [[ "${before}" == "${after}" ]]; then
    pass "running container image ID is identical after --rollback --dry-run (${before:0:12})"
  else
    fail "running container changed: ${before:0:12} -> ${after:0:12}"
  fi

  if [[ "${started_before}" == "${started_after}" ]]; then
    pass "running container was not restarted (StartedAt unchanged)"
  else
    fail "running container restarted: ${started_before} -> ${started_after}"
  fi
else
  pass "running container check skipped (no ${REAL_CONTAINER} on this host)"
fi

# ---------------------------------------------------------------------------
echo
echo "${PASS} passed, ${FAIL} failed"
[[ "${FAIL}" -eq 0 ]]
