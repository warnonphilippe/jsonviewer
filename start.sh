#!/usr/bin/env bash
#
# One command to run the JSON viewer: ./start.sh
#
# Installs npm dependencies if they are missing or out of date, picks a free
# port, and starts the Vite dev server. Nothing else is required -- the app has
# no backend, no database and no services.
#
# Options:
#   -p, --port N     Preferred port (default 4200; the next free one is used
#                    if it is taken).
#   -n, --no-open    Do not open a browser window.
#   -f, --fixture    Also generate a ~59 MB test fixture with the same shape as
#                    the reference export (public/fixtures/large.json), so
#                    the viewer can be tried at full scale without using real
#                    data. Skipped if the file already exists.
#   -c, --clean      Reinstall node_modules from scratch before starting.
#   -b, --build      Produce a production build instead of starting the server.
#   -t, --test       Run the unit tests before starting the server.
#   -h, --help       Show this help.

set -euo pipefail

# Always operate on the project directory, whatever the caller's cwd is.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PORT=4200
OPEN=1
FIXTURE=0
CLEAN=0
BUILD=0
RUN_TESTS=0

# --- pretty output (plain when not a terminal, e.g. piped to a log) ----------
if [ -t 1 ]; then
  BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m')
  RED=$(printf '\033[31m'); YELLOW=$(printf '\033[33m'); RESET=$(printf '\033[0m')
else
  BOLD=''; DIM=''; RED=''; YELLOW=''; RESET=''
fi

say()  { printf '%s\n' "${BOLD}==>${RESET} $*"; }
note() { printf '%s\n' "    ${DIM}$*${RESET}"; }
warn() { printf '%s\n' "${YELLOW}warning:${RESET} $*" >&2; }
die()  { printf '%s\n' "${RED}error:${RESET} $*" >&2; exit 1; }

usage() {
  # Print the header comment block: every comment line from line 3 up to the
  # first line that is not a comment. A fixed line range would rot as the
  # header is edited.
  awk 'NR > 2 && /^#/ { sub(/^#[[:space:]]?/, ""); print; next } NR > 2 { exit }' "$0"
  exit 0
}

# --- arguments ---------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    -p|--port)
      [ $# -ge 2 ] || die "$1 needs a port number"
      PORT="$2"; shift 2
      case "$PORT" in
        ''|*[!0-9]*) die "not a port number: $PORT" ;;
      esac
      ;;
    -n|--no-open)  OPEN=0; shift ;;
    -f|--fixture)  FIXTURE=1; shift ;;
    -c|--clean)    CLEAN=1; shift ;;
    -b|--build)    BUILD=1; shift ;;
    -t|--test)     RUN_TESTS=1; shift ;;
    -h|--help)     usage ;;
    *)             die "unknown option: $1 (try --help)" ;;
  esac
done

# --- toolchain ---------------------------------------------------------------
command -v node >/dev/null 2>&1 || die "Node.js is not installed. See https://nodejs.org"
command -v npm  >/dev/null 2>&1 || die "npm is not installed (it ships with Node.js)"

NODE_VERSION=$(node --version)
NODE_MAJOR=${NODE_VERSION#v}
NODE_MAJOR=${NODE_MAJOR%%.*}

if [ "$NODE_MAJOR" -lt 22 ]; then
  die "Node $NODE_VERSION is too old for Angular 22. Install Node 22, 24 or 26+."
fi
# Angular 22 declares ^22.22.3 || ^24.15.0 || >=26.0.0. Odd-numbered releases
# are not LTS and are not in that range, but they do work -- so advise only.
case "$NODE_MAJOR" in
  22|24|26|28) ;;
  *) warn "Node $NODE_VERSION is outside Angular 22's supported range; it works, but expect a version notice." ;;
esac

say "Node $NODE_VERSION, npm $(npm --version)"

# --- dependencies ------------------------------------------------------------
if [ "$CLEAN" -eq 1 ]; then
  say "Removing node_modules"
  rm -rf node_modules
fi

needs_install=0
if [ ! -d node_modules ]; then
  needs_install=1
  note "node_modules is missing"
elif [ ! -f node_modules/.package-lock.json ]; then
  needs_install=1
  note "node_modules looks incomplete"
elif [ package-lock.json -nt node_modules/.package-lock.json ]; then
  needs_install=1
  note "package-lock.json is newer than the installed tree"
fi

if [ "$needs_install" -eq 1 ]; then
  if [ -f package-lock.json ]; then
    say "Installing dependencies (npm ci)"
    # `npm ci` is exact and reproducible, but it refuses a lockfile that has
    # drifted from package.json -- fall back so a first run never dead-ends.
    npm ci || { warn "npm ci failed; falling back to npm install"; npm install; }
  else
    say "Installing dependencies (npm install)"
    npm install
  fi
else
  say "Dependencies are up to date"
fi

# --- optional test fixture ---------------------------------------------------
if [ "$FIXTURE" -eq 1 ]; then
  if [ -f public/fixtures/large.json ]; then
    say "Test fixture already present"
    note "public/fixtures/large.json ($(du -h public/fixtures/large.json | cut -f1))"
  else
    say "Generating the ~59 MB test fixture"
    note "same shape as the reference export, entirely synthetic values"
    node test/fixtures/gen-large.mjs public/fixtures/large.json
  fi
fi

# --- optional test run -------------------------------------------------------
if [ "$RUN_TESTS" -eq 1 ]; then
  say "Running unit tests"
  npm test
fi

# --- production build instead of serving -------------------------------------
if [ "$BUILD" -eq 1 ]; then
  say "Building for production"
  npm run build
  say "Done"
  note "output in dist/json-viewer"
  exit 0
fi

# --- pick a free port --------------------------------------------------------
# 4200 is the Angular default, so it is often already taken by another project.
# Rather than failing, walk upwards to the next genuinely free port.
#
# Both IP stacks must be checked. A server bound to [::1] only -- which is what
# another `ng serve` on this machine does -- leaves 127.0.0.1 bindable, so an
# IPv4-only probe reports the port free and `ng serve` then dies with
# EADDRINUSE, because it binds `localhost`, which resolves to ::1 first.
free_port=$(node -e '
  const net = require("net");
  const first = Number(process.argv[1]);
  const limit = first + 50;

  const bindable = (port, host) =>
    new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen(port, host);
    });

  (async () => {
    for (let port = first; port <= limit; port++) {
      const free = await Promise.all([bindable(port, "127.0.0.1"), bindable(port, "::1")]);
      if (free.every(Boolean)) {
        process.stdout.write(String(port));
        return;
      }
    }
    process.exit(1);
  })();
' "$PORT") || die "no free port between $PORT and $((PORT + 50))"

if [ "$free_port" != "$PORT" ]; then
  warn "port $PORT is in use; using $free_port instead"
fi

say "Starting the dev server on http://localhost:$free_port"
note "the app is read-only: files you open are never modified"
note "press Ctrl+C to stop"

# An array, so arguments stay separate words without relying on word splitting.
serve_args=(--port "$free_port")
if [ "$OPEN" -eq 1 ]; then
  serve_args+=(--open)
fi

# exec so Ctrl+C reaches the dev server directly rather than this wrapper.
exec npx ng serve "${serve_args[@]}"
