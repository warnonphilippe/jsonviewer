#!/usr/bin/env bash
set -euo pipefail

# Lance le viewer dans une fenetre Electron, sans empaqueter l'application.
#
#   ./desktop/start.sh          -> ouvre la fenetre ; le build du viewer n'est
#                                  refait que s'il manque ou si src/ a change
#   ./desktop/start.sh --build  -> force un nouveau build avant d'ouvrir
#
# La fenetre charge desktop/app/, la copie du build de production : une
# retouche du code n'y apparait qu'apres un nouveau build. Pour developper,
# ./start.sh a la racine (serveur de dev dans le navigateur) est plus adapte.

DESKTOP="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "${DESKTOP}")"
BUILD=0

for arg in "$@"; do
  case "${arg}" in
    --build) BUILD=1 ;;
    -h|--help)
      awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; p = 1; next } p { exit }' "$0"
      exit 0 ;;
    *) echo "Option inconnue : ${arg} (voir --help)" >&2; exit 1 ;;
  esac
done

# Rebuild si l'app manque, ou si un fichier de src/ ou public/ est plus recent.
if [ ! -f "${DESKTOP}/app/index.html" ]; then
  BUILD=1
elif [ -n "$(find "${ROOT}/src" "${ROOT}/public" "${ROOT}/angular.json" "${ROOT}/package.json" \
    -type f -not -path '*/fixtures/*' -newer "${DESKTOP}/app/index.html" -print -quit)" ]; then
  BUILD=1
fi

if [ "${BUILD}" -eq 1 ]; then
  echo "==> Build de production du viewer..."
  [ -d "${ROOT}/node_modules" ] || (cd "${ROOT}" && npm install --no-audit --no-fund)
  (cd "${ROOT}" && npm run build)
  # fixtures/ est exclu : cf. build.sh.
  rsync -a --delete --exclude fixtures "${ROOT}/dist/json-viewer/browser/" "${DESKTOP}/app/"
fi

[ -d "${DESKTOP}/node_modules" ] || (cd "${DESKTOP}" && npm install --no-audit --no-fund)

cd "${DESKTOP}"
exec npm start --silent
