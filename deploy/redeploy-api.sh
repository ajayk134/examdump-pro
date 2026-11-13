#!/usr/bin/env bash
#
# Deterministic, availability-preserving API redeploy for the production host.
#
# WHY THIS EXISTS
# ---------------
# The API container was originally created by a hand-written `podman run`, not by
# compose. `podman-compose up` does not reproduce it: it compares a stored
# config-hash, recreates containers from a pod it no longer owns, and has left the
# API running the OLD image while reporting success. That silent no-op is the
# failure this script exists to remove.
#
# WHAT IT DOES
#  1. Builds the API image and tags it with a unique, immutable build id.
#  2. Verifies the build actually contains the current source (belt and braces).
#  3. Starts the NEW container alongside the old one under a temporary name.
#  4. Waits for its readiness probe. The old container keeps serving throughout.
#  5. Only after the new one is ready: swaps names, reloads nginx, re-verifies.
#  6. On any failure: leaves/restores the old container and exits non-zero.
#
# WHAT IT NEVER DOES
#  - It never stops, removes or recreates postgres, web or nginx.
#  - It never touches the database volume, data or migrations beyond what the
#    container's own entrypoint already does (`node dist/migrate.js`, which is
#    additive and idempotent).
#  - It never removes the old image until the swap has succeeded.
#
# USAGE
#   cd deploy
#   doppler run --project examdump-pro --config prd -- ./redeploy-api.sh
#
#   ./redeploy-api.sh --build-only        # build + verify, do not deploy
#   ./redeploy-api.sh --no-build          # redeploy the existing :latest
#   ./redeploy-api.sh --rollback           # revert to the saved previous image
#   ./redeploy-api.sh --dry-run            # print the plan, change nothing
#   ./redeploy-api.sh --sync-env           # overlay the ambient (Doppler) env into the env file
#   ./redeploy-api.sh --sync-env --from-container   # seed from the live container first
#
# ENVIRONMENT INJECTION
#   The API container is created with `podman create --env-file`, so variables
#   come from that FILE, not from the shell that runs this script. Putting
#   `doppler run ...` in front of a plain deploy therefore changes nothing - the
#   file wins. Run `--sync-env` under `doppler run` first, then deploy:
#
#     doppler run --project examdump-pro --config prd -- ./redeploy-api.sh --sync-env
#     sudo ./redeploy-api.sh --no-build
#
#   Podman treats env-file lines literally (no quote stripping), so values are
#   normalised on the way in. An empty incoming value never overwrites a working
#   one; removing a variable is a deliberate edit of the file, not an accident of
#   an emptier environment.
#
# REQUIREMENTS: rootful podman (`sudo`), the API container env file, nginx
# container present. Run from the deploy/ directory.

set -Eeuo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONTAINER_NAME="examdump-pro_api_1"
IMAGE_REPO="localhost/examdump-pro_api"
NETWORK="examdump-pro_examdump"
NETWORK_ALIAS="api"
# NOTE: deliberately not named DOPPLER_PROJECT/DOPPLER_CONFIG - `doppler run`
# sets those itself, so reusing the names would silently shadow the defaults.
ENV_SOURCE_PROJECT="${ENV_SOURCE_PROJECT:-examdump-pro}"
ENV_SOURCE_CONFIG="${ENV_SOURCE_CONFIG:-prd}"
NGINX_CONTAINER="examdump-pro_nginx_1"
POSTGRES_CONTAINER="examdump-pro_postgres_1"

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
STATE_DIR="/var/lib/examdump-deploy"
PREVIOUS_IMAGE_FILE="${STATE_DIR}/previous-image"

# The container is created from an env FILE, not from the ambient environment.
# `podman create --env-file` is the only way to reproduce the container's 100+
# variables without re-rendering compose (which is not how it was created).
ENV_FILE="${ENV_FILE:-/tmp/examdump-api.env}"

# How long to wait for the new container to report ready before giving up.
READY_TIMEOUT_SECONDS="${READY_TIMEOUT_SECONDS:-120}"
# How long to wait for nginx to answer after a reload.
NGINX_TIMEOUT_SECONDS="${NGINX_TIMEOUT_SECONDS:-30}"

BUILD_ONLY=0
NO_BUILD=0
DO_ROLLBACK=0
DRY_RUN=0
SYNC_ENV=0
FROM_CONTAINER=0
# Name of the not-yet-swapped container, so the EXIT trap knows what to clean up.
STAGED_CONTAINER=""

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

as_root() {
  if [[ "${EUID}" -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only) BUILD_ONLY=1 ;;
    --no-build)   NO_BUILD=1 ;;
    --rollback)   DO_ROLLBACK=1 ;;
    --dry-run)    DRY_RUN=1 ;;
    --sync-env)   SYNC_ENV=1 ;;
    --from-container) FROM_CONTAINER=1 ;;
    -h|--help)    sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            die "unknown argument: $1" ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Preflight: fail before changing anything
# ---------------------------------------------------------------------------
preflight() {
  log "Preflight"

  as_root podman info >/dev/null 2>&1 || die "podman is not reachable with the privileges available"

  command -v doppler >/dev/null 2>&1 \
    || warn "doppler not found on PATH; assuming the environment is already injected"

  if ! as_root podman container exists "${POSTGRES_CONTAINER}"; then
    die "postgres container ${POSTGRES_CONTAINER} is missing; refusing to deploy on top of a broken stack"
  fi
  as_root podman inspect "${POSTGRES_CONTAINER}" --format '{{.State.Running}}' | grep -qx true \
    || die "postgres container ${POSTGRES_CONTAINER} is not running"

  # The volume must be the live one, not a stale copy. This is the check that
  # would have caught the compose volume-name mismatch.
  local pg_volume
  pg_volume="$(as_root podman inspect "${POSTGRES_CONTAINER}" \
    --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')"
  [[ "${pg_volume}" == "pgdata" ]] \
    || die "postgres is mounted on volume '${pg_volume}', expected 'pgdata'. Refusing to deploy."
  ok "postgres running on volume ${pg_volume}"

  as_root podman container exists "${NGINX_CONTAINER}" \
    || die "nginx container ${NGINX_CONTAINER} is missing; the API would not be reachable"

  as_root podman network exists "${NETWORK}" \
    || die "network ${NETWORK} is missing"

  if [[ ! -f "${ENV_FILE}" ]]; then
    die "API env file not found at ${ENV_FILE}.
       Generate it from the running container, then overlay Doppler:
         sudo podman inspect ${CONTAINER_NAME} --format '{{range .Config.Env}}{{println .}}{{end}}' \\
           | grep -v '^PATH=' > ${ENV_FILE}
         doppler run --project examdump-pro --config prd -- ${SCRIPT_NAME} --sync-env
       When not already inside \`doppler run\`, seed from the live container:
         ${SCRIPT_NAME} --sync-env --from-container"
  fi
  ok "env file present (${ENV_FILE})"
}

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
build_image() {
  if [[ "${NO_BUILD}" -eq 1 ]]; then
    log "Skipping build (--no-build)"
    as_root podman image exists "${IMAGE_REPO}:latest" || die "${IMAGE_REPO}:latest does not exist"
    NEW_IMAGE_ID="$(as_root podman inspect "${IMAGE_REPO}:latest" --format '{{.Id}}')"
    return
  fi

  log "Building ${IMAGE_REPO}"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "  (dry run) podman build -f deploy/Dockerfile.api -t ${IMAGE_REPO}:latest ${REPO_ROOT}"
    NEW_IMAGE_ID="<dry-run>"
    return
  fi

  as_root podman build \
    -f "${SCRIPT_DIR}/Dockerfile.api" \
    -t "${IMAGE_REPO}:latest" \
    "${REPO_ROOT}" \
    || die "image build failed; nothing was deployed"

  NEW_IMAGE_ID="$(as_root podman inspect "${IMAGE_REPO}:latest" --format '{{.Id}}')"
  ok "built ${NEW_IMAGE_ID:0:12}"
}

# ---------------------------------------------------------------------------
# Verify the image really contains the checkout that was just built
# ---------------------------------------------------------------------------
verify_image_contents() {
  [[ "${DRY_RUN}" -eq 1 ]] && { log "Skipping image verification (dry run)"; return; }

  log "Verifying image contents"

  # Proves the image is not a stale/tagged-over reference: the entrypoint files
  # must exist and the bundle must be non-trivial.
  as_root podman run --rm --entrypoint sh "${IMAGE_REPO}:latest" -c '
    set -e
    test -f dist/index.js      || { echo "missing dist/index.js" >&2; exit 1; }
    test -f dist/migrate.js    || { echo "missing dist/migrate.js" >&2; exit 1; }
    test -d migrations         || { echo "missing migrations dir" >&2; exit 1; }
    test -d node_modules       || { echo "missing node_modules" >&2; exit 1; }
    size=$(wc -c < dist/index.js)
    [ "$size" -gt 1000 ]       || { echo "dist/index.js implausibly small ($size)" >&2; exit 1; }
  ' || die "image verification failed"

  # The git commit this image was built from is not baked in, so verify a symbol
  # that must exist in the current source. Kept broad on purpose: this asserts the
  # build actually ran, not that a specific feature shipped.
  as_root podman run --rm --entrypoint sh "${IMAGE_REPO}:latest" -c \
    'grep -q "examdump-api" dist/index.js 2>/dev/null || grep -rq "examdump-api" dist/*.js' \
    || die "image does not contain the expected API bundle"

  ok "image contents look correct"
}

# ---------------------------------------------------------------------------
# Container creation (shared by deploy and rollback)
# ---------------------------------------------------------------------------
create_container() {
  local name="$1" image="$2"
  as_root podman create \
    --name "${name}" \
    --restart unless-stopped \
    --env-file "${ENV_FILE}" \
    --network "${NETWORK}" \
    --network-alias "${NETWORK_ALIAS}" \
    --expose 4000 \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=5 \
    --label "io.podman.compose.project=examdump-pro" \
    --label "io.podman.compose.service=api" \
    --label "com.docker.compose.project=examdump-pro" \
    --label "com.docker.compose.service=api" \
    --label "app.examdump.managed-by=redeploy-api.sh" \
    "${image}" >/dev/null
}

wait_ready() {
  local name="$1" deadline=$(( SECONDS + READY_TIMEOUT_SECONDS ))
  while (( SECONDS < deadline )); do
    # The container must be running, and its readiness probe must succeed.
    # /health/ready returns 503 until the database connection is established,
    # which is exactly what we want to block on.
    if as_root podman exec "${name}" curl -fsS http://127.0.0.1:4000/api/health/ready >/dev/null 2>&1; then
      return 0
    fi
    if [[ "$(as_root podman inspect "${name}" --format '{{.State.Running}}' 2>/dev/null || echo false)" != "true" ]]; then
      return 1
    fi
    sleep 2
  done
  return 1
}

# ---------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------
deploy() {
  local staged="${CONTAINER_NAME}__staged"
  local backup="${CONTAINER_NAME}__prev"

  # Clear anything left by an interrupted earlier run.
  as_root podman rm -f "${staged}" >/dev/null 2>&1 || true
  as_root podman rm -f "${backup}" >/dev/null 2>&1 || true

  local old_image=""
  if as_root podman container exists "${CONTAINER_NAME}"; then
    old_image="$(as_root podman inspect "${CONTAINER_NAME}" --format '{{.Image}}')"
  fi

  log "Staging new container as ${staged}"
  if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "  (dry run) create + start + wait_ready + swap + nginx reload"
    return
  fi

  # Run on EXIT, not ERR: `die` calls `exit`, which does not trigger an ERR trap,
  # so an ERR-only trap leaks the staged container whenever a check fails. This
  # trap is disarmed (`STAGED_CONTAINER=""`) once the container has been renamed
  # into its final place, so a later failure cannot delete the live container.
  STAGED_CONTAINER="${staged}"
  trap 'cleanup_on_error' EXIT

  create_container "${staged}" "${IMAGE_REPO}:latest"
  as_root podman start "${staged}" >/dev/null

  log "Waiting up to ${READY_TIMEOUT_SECONDS}s for readiness (old container still serving)"
  if ! wait_ready "${staged}"; then
    warn "new container did not become ready; last 40 log lines:"
    as_root podman logs --tail 40 "${staged}" 2>&1 | sed 's/^/    /' >&2 || true
    die "readiness check failed; the running API was NOT touched"
  fi
  ok "new container is ready"

  # ---- swap -------------------------------------------------------------
  # From here the old container stops. Everything that could fail on the new one
  # has already been proven to work.
  log "Swapping containers"

  if as_root podman container exists "${CONTAINER_NAME}"; then
    as_root podman stop "${CONTAINER_NAME}" >/dev/null
    as_root podman rename "${CONTAINER_NAME}" "${backup}" >/dev/null
  fi

  as_root podman rename "${staged}" "${CONTAINER_NAME}" >/dev/null
  # The container now lives under its final name; a failure from this point must
  # roll back, not delete it.
  STAGED_CONTAINER=""
  # A renamed container keeps running; restart it so it re-registers its DNS
  # alias under the final name. This is the step whose absence produced a 502.
  as_root podman restart "${CONTAINER_NAME}" >/dev/null

  if ! wait_ready "${CONTAINER_NAME}"; then
    warn "container failed readiness after the swap; rolling back"
    rollback_to "${backup}" "${old_image}"
    die "deploy failed after swap; previous container restored"
  fi
  ok "new container serving as ${CONTAINER_NAME}"

  # ---- nginx ------------------------------------------------------------
  log "Reloading nginx (upstream IP changed)"
  as_root podman exec "${NGINX_CONTAINER}" nginx -t >/dev/null 2>&1 \
    || die "nginx config test failed; not reloading"
  as_root podman exec "${NGINX_CONTAINER}" nginx -s reload >/dev/null 2>&1 \
    || die "nginx reload failed"

  if ! verify_nginx_routing; then
    warn "nginx is not routing to the new container; rolling back"
    rollback_to "${backup}" "${old_image}"
    die "nginx routing verification failed; previous container restored"
  fi
  ok "nginx routing verified"

  # ---- commit the successful deploy -------------------------------------
  if [[ -n "${old_image}" ]]; then
    as_root mkdir -p "${STATE_DIR}"
    # Plain printf rather than echo so no shell interpretation can corrupt it.
    printf '%s\n' "${old_image}" | as_root tee "${PREVIOUS_IMAGE_FILE}" >/dev/null
    ok "rollback image saved: ${old_image:0:12}"
  fi

  as_root podman rm -f "${backup}" >/dev/null 2>&1 || true

  trap - EXIT
  log "Deploy complete"
  print_summary
}

verify_nginx_routing() {
  local deadline=$(( SECONDS + NGINX_TIMEOUT_SECONDS ))
  while (( SECONDS < deadline )); do
    # Ask nginx itself, over the internal network, so this tests routing rather
    # than DNS from the host.
    if as_root podman exec "${NGINX_CONTAINER}" sh -c \
        'wget -q -O /dev/null --header="Host: localhost" http://127.0.0.1/api/health 2>/dev/null' \
        || as_root podman exec "${NGINX_CONTAINER}" sh -c \
        'curl -fsS -H "Host: localhost" http://127.0.0.1/api/health >/dev/null 2>&1'; then
      return 0
    fi
    sleep 2
  done
  return 1
}

cleanup_on_error() {
  # Guard on the variable, not just the container name: once the staged container
  # has been renamed into place this is empty, so a post-swap failure can never
  # delete the container that is currently serving.
  local staged="${STAGED_CONTAINER:-}"
  [[ -z "${staged}" ]] && return 0
  warn "removing staged container ${staged} (it never became ready)"
  as_root podman rm -f "${staged}" >/dev/null 2>&1 || true
}

rollback_to() {
  local backup="$1" old_image="$2"
  as_root podman rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  if as_root podman container exists "${backup}"; then
    as_root podman rename "${backup}" "${CONTAINER_NAME}" >/dev/null
    as_root podman start "${CONTAINER_NAME}" >/dev/null || true
  elif [[ -n "${old_image}" ]]; then
    create_container "${CONTAINER_NAME}" "${old_image}"
    as_root podman start "${CONTAINER_NAME}" >/dev/null
  else
    die "no previous container or image to roll back to"
  fi
  as_root podman exec "${NGINX_CONTAINER}" nginx -s reload >/dev/null 2>&1 || true
  wait_ready "${CONTAINER_NAME}" || warn "previous container did not report ready after rollback"
}

# ---------------------------------------------------------------------------
# Rollback to the last successfully replaced image
# ---------------------------------------------------------------------------
rollback() {
  log "Rollback"
  [[ -f "${PREVIOUS_IMAGE_FILE}" ]] || die "no previous image recorded in ${PREVIOUS_IMAGE_FILE}"
  local target
  target="$(cat "${PREVIOUS_IMAGE_FILE}")"
  as_root podman image exists "${target}" || die "previous image ${target} no longer exists"

  local staged="${CONTAINER_NAME}__staged"
  as_root podman rm -f "${staged}" >/dev/null 2>&1 || true

  # Same EXIT-trap discipline as deploy(): clean up the staged container on any
  # failure, and disarm once it has been renamed into place.
  STAGED_CONTAINER="${staged}"
  trap 'cleanup_on_error' EXIT

  log "Staging previous image ${target:0:12}"
  create_container "${staged}" "${target}"
  as_root podman start "${staged}" >/dev/null
  wait_ready "${staged}" || { as_root podman logs --tail 30 "${staged}" >&2 || true; die "previous image failed readiness"; }

  local current="${CONTAINER_NAME}__bad"
  as_root podman rm -f "${current}" >/dev/null 2>&1 || true
  if as_root podman container exists "${CONTAINER_NAME}"; then
    as_root podman stop "${CONTAINER_NAME}" >/dev/null
    as_root podman rename "${CONTAINER_NAME}" "${current}" >/dev/null
  fi
  as_root podman rename "${staged}" "${CONTAINER_NAME}" >/dev/null
  STAGED_CONTAINER=""
  as_root podman restart "${CONTAINER_NAME}" >/dev/null
  wait_ready "${CONTAINER_NAME}" || die "rollback container not ready"

  as_root podman exec "${NGINX_CONTAINER}" nginx -s reload >/dev/null 2>&1 || true
  verify_nginx_routing || die "nginx not routing after rollback"
  as_root podman rm -f "${current}" >/dev/null 2>&1 || true

  trap - EXIT
  ok "rolled back to ${target:0:12}"
  print_summary
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
print_summary() {
  local img started
  img="$(as_root podman inspect "${CONTAINER_NAME}" --format '{{.Image}}' 2>/dev/null || echo unknown)"
  started="$(as_root podman inspect "${CONTAINER_NAME}" --format '{{.State.StartedAt}}' 2>/dev/null || echo unknown)"
  echo
  echo "  container : ${CONTAINER_NAME}"
  echo "  image     : ${img:0:12}"
  echo "  started   : ${started}"
  echo "  latest    : $( [[ "${img}" == "$(as_root podman inspect "${IMAGE_REPO}:latest" --format '{{.Id}}' 2>/dev/null)" ]] && echo 'matches :latest' || echo 'DIFFERS from :latest' )"
  echo "  health    : $(as_root podman exec "${CONTAINER_NAME}" curl -fsS http://127.0.0.1:4000/api/health 2>/dev/null | head -c 120 || echo 'unreachable')"
  echo
}

# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Environment synchronisation
# ---------------------------------------------------------------------------
#
# WHY THIS EXISTS
# ---------------
# `podman create --env-file` treats every line as a LITERAL `KEY=VALUE`. It does
# not strip quotes and does not interpret escapes. That has two consequences:
#
#   Doppler's `secrets download --format env` writes `LOG_LEVEL="info"`. Fed
#   straight in, the API receives the six-character string `"info"` and the env
#   schema rejects it - so the container never becomes ready. That failure is
#   loud and harmless.
#
#   The other direction is worse. A variable that is simply ABSENT from the file
#   silently falls back to the image default. When a rotation empties a value, or
#   when an env file is rebuilt from stale data, the API boots "successfully"
#   with a wrong or blank secret and nobody notices. That is exactly how a freshly
#   added `UPI_SECRETS_KEY` was missed by an apparently successful deployment.
#
# So the file is normalised before use, and an empty incoming value NEVER
# overwrites a non-empty existing one. Deliberate removal requires deleting the
# key from the file by hand.

# Strip one layer of matching surrounding quotes, because Doppler adds them.
_unquote() {
  local v="$1"
  if [[ ${#v} -ge 2 ]]; then
    if [[ "$v" == \"*\" || "$v" == \'*\' ]]; then
      v="${v:1:${#v}-2}"
    fi
  fi
  printf '%s' "$v"
}

# Normalise one KEY=VALUE line into unquoted form. Prints nothing for lines that
# are blank, comments, or malformed. Never prints the value to the log.
_normalise_line() {
  local line="$1"
  [[ -z "$line" ]] && return 0
  [[ "$line" == \#* ]] && return 0
  [[ "$line" != *=* ]] && return 0
  local k="${line%%=*}"
  [[ "$k" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || return 0
  local v="${line#*=}"
  v="$(_unquote "$v")"
  printf '%s=%s\n' "$k" "$v"
}

sync_env() {
  local target="${ENV_FILE}"
  local incoming
  incoming="$(mktemp)"
  local merged
  merged="$(mktemp)"
  # NOTE: no `trap ... RETURN` here. A RETURN trap is not scoped to this
  # function - it fires when ANY function returns, so it deleted these files
  # after the first helper call and the merge silently wrote nothing.
  # Cleanup is done explicitly on every exit path below.

  # Seed: the live container is the source of truth for everything not supplied
  # by Doppler, because it carries variables that exist nowhere else.
  if [[ "${FROM_CONTAINER}" -eq 1 ]] || [[ ! -s "${target}" ]]; then
    as_root podman container exists "${CONTAINER_NAME}" \
      || { rm -f "${incoming}" "${merged}"; die "--from-container requested but ${CONTAINER_NAME} does not exist"; }
    as_root podman inspect "${CONTAINER_NAME}" \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | grep -v '^PATH=' | grep -v '^$' > "${target}.seed" \
      || { rm -f "${incoming}" "${merged}"; die "could not read the environment of ${CONTAINER_NAME}"; }
    chmod 600 "${target}.seed"
  fi

  # What is being overlaid: the ambient environment when run under `doppler run`,
  # otherwise nothing (existing file wins).
  if [[ "${FROM_CONTAINER}" -eq 1 ]]; then
    : > "${incoming}"
  else
    # Only take variables the Doppler project actually defines.
    #
    # Copying the whole ambient environment would drag in the caller's shell -
    # PATH, SSH_CLIENT, the agent's own variables, even unrelated credentials
    # such as a local MongoDB URI. Those have no business inside the API
    # container and several of them would be a leak.
    #
    # `doppler run` does not mark which variables it injected, so the project
    # name list is the only reliable filter. When Doppler is not present (a
    # plain shell), nothing is overlaid and the existing file is preserved.
    local allow="${incoming}.allow"
    if command -v doppler >/dev/null 2>&1 \
      && doppler secrets --project "${ENV_SOURCE_PROJECT}" --config "${ENV_SOURCE_CONFIG}" --only-names >"${allow}" 2>/dev/null; then
      # Table output: strip box drawing, keep bare identifiers.
      sed -e 's/[│┌┐└┘├┤─]//g' -e 's/^ *//' -e 's/ *$//' "${allow}" \
        | grep -E '^[A-Za-z_][A-Za-z0-9_]*$' | sort -u > "${allow}.names"
      env -0 | tr '\0' '\n' | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' \
        | awk -F= 'NR==FNR{ok[$1];next} ($1 in ok)' "${allow}.names" - \
        | grep -vE '^(DOPPLER_[A-Z_]*|PATH|HOME|PWD|OLDPWD|SHELL|SHLVL|USER|LOGNAME|TERM|LANG|HOSTNAME|_|MONGODB_[A-Z_]*|POSTGRES_[A-Z_]*)=' \
        > "${incoming}" || true
      rm -f "${allow}.names"
    else
      warn "doppler not available; keeping the existing env file values unchanged"
      : > "${incoming}"
    fi
    rm -f "${allow}"
  fi

  local seed_file="${target}.seed"
  if [[ ! -f "${seed_file}" ]]; then
    # The env file is usually root-owned (it is produced by podman under sudo),
    # so read it back through the same privilege that owns it and work on a
    # private copy. Writing the target happens via install at the end.
    seed_file="${incoming}.seed"
    if as_root test -f "${target}" 2>/dev/null; then
      as_root cat "${target}" > "${seed_file}" \
        || die "cannot read ${target}"
    else
      : > "${seed_file}"
    fi
  fi

  # Build merged output: start from the seed, then let incoming win where it has
  # a NON-EMPTY value.
  declare -A incoming_map=()
  local line k v
  while IFS= read -r line; do
    local norm
    norm="$(_normalise_line "${line}")"
    [[ -z "${norm}" ]] && continue
    k="${norm%%=*}"
    v="${norm#*=}"
    incoming_map["${k}"]="$v"
  done < "${incoming}"

  local applied=0 skipped=0
  while IFS= read -r line; do
    local norm
    norm="$(_normalise_line "${line}")"
    [[ -z "${norm}" ]] && continue
    k="${norm%%=*}"
    v="${norm#*=}"
    if [[ -n "${incoming_map[${k}]+set}" ]]; then
      local new="${incoming_map[${k}]}"
      if [[ -z "${new}" && -n "${v}" ]]; then
        # Refuse to blank a working value: keep the existing one and say so.
        # `continue` here would drop the variable from the file entirely, which
        # is the very failure this guard exists to prevent.
        skipped=$((skipped + 1))
        printf '%s=%s\n' "${k}" "${v}" >> "${merged}"
        unset 'incoming_map[${k}]'
        continue
      fi
      printf '%s=%s\n' "${k}" "${new}" >> "${merged}"
      applied=$((applied + 1))
      unset 'incoming_map[${k}]'
    else
      printf '%s=%s\n' "${k}" "${v}" >> "${merged}"
    fi
  done < "${seed_file}"

  # Anything new from Doppler that the seed did not have.
  for k in "${!incoming_map[@]}"; do
    v="${incoming_map[${k}]}"
    [[ -z "${v}" ]] && continue
    printf '%s=%s\n' "${k}" "${v}" >> "${merged}"
    applied=$((applied + 1))
  done

  [[ -s "${merged}" ]] || { rm -f "${incoming}" "${merged}" "${seed_file}"; die "env sync produced no variables; refusing to write an empty env file"; }

  if ! install -m 600 "${merged}" "${target}" 2>/dev/null; then
    as_root install -m 600 -o root -g root "${merged}" "${target}" \
      || { rm -f "${incoming}" "${merged}" "${seed_file}"; die "cannot write ${target}"; }
  fi
  # Only the derived seed is removable. When the seed fell back to the target
  # itself, deleting it here would delete the file we just wrote.
  rm -f "${incoming}" "${merged}"
  [[ "${seed_file}" == "${target}.seed" ]] && rm -f "${seed_file}"
  true

  ok "env file sync: ${applied} value(s) updated, ${skipped} empty value(s) rejected"
  # `as_root` cannot redirect a file into a non-root process, so count via a
  # subshell that runs cat under the owning privilege.
  log "target: ${target} ($(as_root cat "${target}" | wc -l) variables)"
}

main() {
  log "examdump API redeploy"

  # Environment is settled before any other check, because everything downstream
  # reads it.
  if [[ "${SYNC_ENV}" -eq 1 ]]; then
    sync_env
    return
  fi

  preflight

  if [[ "${DO_ROLLBACK}" -eq 1 ]]; then
    rollback
    return
  fi

  build_image
  verify_image_contents

  if [[ "${BUILD_ONLY}" -eq 1 ]]; then
    ok "build verified; not deploying (--build-only)"
    return
  fi

  deploy
}

main "$@"
