#!/usr/bin/env bash
set -euo pipefail

# Construit l'application de bureau du viewer : une fenetre Electron qui
# affiche le build de production. Ni Docker, ni serveur, ni navigateur a lancer.
#
#   ./desktop/build.sh            -> JSON Viewer.app pour ce Mac, dans desktop/out/
#   ./desktop/build.sh --install  -> idem, puis copie dans /Applications
#   ./desktop/build.sh --dmg      -> desktop/out/JSON Viewer-<version>.dmg, pour
#                                    installer sur un autre Mac (Intel ou Apple
#                                    Silicon : l'app y est universelle)
#   ./desktop/build.sh --windows  -> desktop/out/JSON Viewer-<version>-win32-x64.zip,
#                                    qui contient JSON Viewer.exe
#
# --install et --dmg se combinent. Prerequis : Node et npm comme pour le reste
# du projet, plus codesign et hdiutil (macOS) pour les versions Mac. Electron
# est installe dans desktop/node_modules, a part : le projet Angular et l'image
# Docker n'en dependent pas.

DESKTOP="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "${DESKTOP}")"
OUT="${DESKTOP}/out"
NAME="JSON Viewer"
# L'editeur : le compte Docker Hub de deploy.sh. Sans lui, l'exe Windows
# garderait « GitHub, Inc. », celui du binaire Electron d'origine.
PUBLISHER="pwarnon"
INSTALL=0
DMG=0
WINDOWS=0

usage() {
  # Le bloc de commentaires d'en-tete : pas de plage de lignes figee, qui se
  # decalerait a chaque retouche.
  awk 'NR > 2 && /^#/ { sub(/^# ?/, ""); print; p = 1; next } p { exit }' "$0"
  exit 0
}

die() { echo "$*" >&2; exit 1; }

for arg in "$@"; do
  case "${arg}" in
    --install) INSTALL=1 ;;
    --dmg) DMG=1 ;;
    --windows) WINDOWS=1 ;;
    -h|--help) usage ;;
    *) die "Option inconnue : ${arg} (voir --help)" ;;
  esac
done

if [ "${WINDOWS}" -eq 1 ]; then
  [ "${INSTALL}" -eq 0 ] && [ "${DMG}" -eq 0 ] || die "--windows ne se combine ni avec --install ni avec --dmg"
  # x64 tourne aussi sur les PC Windows ARM, en emulation.
  PLATFORM="win32"
  ARCH="x64"
elif [ "${DMG}" -eq 1 ]; then
  # Un DMG part sur un Mac dont on ne connait pas la puce : les deux dans un
  # seul binaire, pour ~2x la taille.
  PLATFORM="darwin"
  ARCH="universal"
else
  PLATFORM="darwin"
  case "$(uname -m)" in
    arm64)  ARCH="arm64" ;;
    x86_64) ARCH="x64" ;;
    *) die "Architecture non prise en charge : $(uname -m)" ;;
  esac
fi

# La version de l'app est celle du viewer : une seule source, ../package.json.
VERSION="$(node -p "require('${ROOT}/package.json').version")"

echo "==> Build de production du viewer (${VERSION})..."
[ -d "${ROOT}/node_modules" ] || (cd "${ROOT}" && npm install --no-audit --no-fund)
(cd "${ROOT}" && npm run build)

# fixtures/ est exclu : le glob d'assets d'angular.json y recopie les 59 Mo de
# public/fixtures/large.json quand la fixture a ete generee.
echo "==> Copie du build dans desktop/app..."
rsync -a --delete --exclude fixtures "${ROOT}/dist/json-viewer/browser/" "${DESKTOP}/app/"

[ -d "${DESKTOP}/node_modules" ] || (cd "${DESKTOP}" && npm install --no-audit --no-fund)

# main.cjs n'importe que des modules d'Electron et de Node : node_modules est
# exclu en entier, l'app ne contient que main.cjs, package.json et app/.
PACKAGER=(
  --platform="${PLATFORM}"
  --arch="${ARCH}"
  --app-version="${VERSION}"
  --app-copyright="Copyright (C) $(date +%Y) ${PUBLISHER}"
  --ignore='^/(out|node_modules|build\.sh|icons\.sh|icon\.(svg|icns|ico)|\.npmrc|package-lock\.json)(/|$)'
  --out="${OUT}"
  --overwrite
  --quiet
)
if [ "${PLATFORM}" = "darwin" ]; then
  PACKAGER+=(
    --icon="${DESKTOP}/icon.icns"
    --app-bundle-id="be.${PUBLISHER}.json-viewer"
    --app-category-type=public.app-category.developer-tools
  )
else
  # Ce qu'affichent l'Explorateur (Proprietes > Details) et le Gestionnaire
  # des taches. Ecrit par resedit, en JavaScript : pas besoin de Wine.
  PACKAGER+=(
    --icon="${DESKTOP}/icon.ico"
    --win32metadata.CompanyName="${PUBLISHER}"
    --win32metadata.ProductName="${NAME}"
    --win32metadata.FileDescription="${NAME}"
  )
fi

echo "==> Assemblage de ${NAME} (${PLATFORM}-${ARCH})..."
"${DESKTOP}/node_modules/.bin/electron-packager" "${DESKTOP}" "${NAME}" "${PACKAGER[@]}"
BUNDLE="${OUT}/${NAME}-${PLATFORM}-${ARCH}"

# --- Windows : un zip du dossier ---------------------------------------------
if [ "${PLATFORM}" = "win32" ]; then
  # JSON Viewer.exe a besoin des DLL et de resources/ a cote de lui : c'est le
  # dossier entier qui se distribue, pas l'exe seul.
  cat > "${BUNDLE}/LISEZ-MOI.txt" <<EOF
JSON Viewer ${VERSION} pour Windows 10 et 11 (64 bits)

1. Clic droit sur le zip > Extraire tout. Ne pas lancer l'exe depuis
   l'intérieur du zip : il lui faut les fichiers qui l'accompagnent.
2. Double-cliquer sur « JSON Viewer.exe ». Le dossier peut être déplacé
   n'importe où, par exemple dans Documents ; clic droit sur l'exe >
   « Épingler à la barre des tâches » pour le garder sous la main.

Au premier lancement, Windows SmartScreen peut afficher « Windows a protégé
votre ordinateur » : l'application n'est pas signée. Cliquer sur
« Informations complémentaires », puis « Exécuter quand même ».

---

JSON Viewer ${VERSION} for Windows 10 and 11 (64-bit)

1. Right-click the zip > Extract All. Do not run the exe from inside the zip:
   it needs the files next to it.
2. Double-click "JSON Viewer.exe". The folder can live anywhere; right-click
   the exe > "Pin to taskbar" to keep it at hand.

On first launch Windows SmartScreen may say "Windows protected your PC": the
app is not signed. Click "More info", then "Run anyway".
EOF
  ZIP="${OUT}/${NAME}-${VERSION}-win32-x64.zip"
  rm -f "${ZIP}"
  (cd "${OUT}" && zip -qrX "${ZIP}" "$(basename "${BUNDLE}")")

  echo ""
  echo "Version Windows prete :"
  echo "  ${ZIP} ($(du -h "${ZIP}" | cut -f1))"
  exit 0
fi

# --- macOS -------------------------------------------------------------------
APP="${BUNDLE}/${NAME}.app"

# Le packager modifie le bundle (nom, Info.plist, icone), ce qui invalide la
# signature d'origine d'Electron. Sur Apple Silicon, un binaire sans signature
# valide est tue au lancement : on resigne en ad hoc (« - »), sans certificat.
echo "==> Signature ad hoc..."
codesign --force --deep --sign - "${APP}"

if [ "${DMG}" -eq 1 ]; then
  echo "==> Creation du DMG..."
  STAGE="$(mktemp -d)"
  trap 'rm -rf "${STAGE}"' EXIT
  # mktemp cree le dossier en 700, et il devient la racine du volume.
  chmod 755 "${STAGE}"
  ditto "${APP}" "${STAGE}/${NAME}.app"
  # Le raccourci vers /Applications : installer, c'est glisser l'app dessus.
  ln -s /Applications "${STAGE}/Applications"
  cat > "${STAGE}/LISEZ-MOI.txt" <<EOF
JSON Viewer ${VERSION} pour macOS 13 ou plus récent, Mac Intel ou Apple Silicon

1. Glisser « JSON Viewer » sur le dossier « Applications ».
2. L'application n'est pas notarisée par Apple : macOS bloque son premier
   lancement. Au choix :
   - l'ouvrir une fois, puis Réglages Système > Confidentialité et sécurité >
     « Ouvrir quand même » ;
   - ou, dans le Terminal :
       xattr -dr com.apple.quarantine "/Applications/JSON Viewer.app"
   Ensuite elle s'ouvre normalement.
3. Clic droit sur son icône dans le Dock > Options > Garder dans le Dock.

---

JSON Viewer ${VERSION} for macOS 13 or later, Intel or Apple Silicon

1. Drag "JSON Viewer" onto the "Applications" folder.
2. The app is not notarised by Apple, so macOS blocks its first launch.
   Either:
   - open it once, then System Settings > Privacy & Security > "Open Anyway";
   - or, in Terminal:
       xattr -dr com.apple.quarantine "/Applications/JSON Viewer.app"
   It opens normally from then on.
3. Right-click its Dock icon > Options > Keep in Dock.
EOF
  DMGFILE="${OUT}/${NAME}-${VERSION}.dmg"
  # ULFO (lzfse) : compression correcte et rapide, lisible des macOS 10.11.
  hdiutil create -quiet -ov -volname "${NAME} ${VERSION}" -srcfolder "${STAGE}" \
    -format ULFO "${DMGFILE}"
fi

if [ "${INSTALL}" -eq 1 ]; then
  # /Applications si on peut y ecrire, sinon ~/Applications (aussi indexe par
  # Spotlight et le Launchpad).
  DEST="/Applications"
  if [ ! -w "${DEST}" ]; then
    DEST="${HOME}/Applications"
    mkdir -p "${DEST}"
  fi
  echo "==> Installation dans ${DEST}..."
  rm -rf "${DEST}/${NAME}.app"
  ditto "${APP}" "${DEST}/${NAME}.app"
  APP="${DEST}/${NAME}.app"
fi

echo ""
echo "Application prete :"
echo "  ${APP}"
if [ "${DMG}" -eq 1 ]; then
  echo "DMG a transmettre :"
  echo "  ${DMGFILE} ($(du -h "${DMGFILE}" | cut -f1))"
fi
echo ""
echo "Pour la lancer :"
echo "  open \"${APP}\""
echo "Puis clic droit sur son icone dans le Dock > Options > Garder dans le Dock."
