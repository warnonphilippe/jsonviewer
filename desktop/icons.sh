#!/usr/bin/env bash
set -euo pipefail

# Regenere icon.icns (macOS) et icon.ico (Windows) a partir de icon.svg. Les
# deux fichiers sont commites : ce script ne sert que quand l'icone change.
#
#   ./desktop/icons.sh
#
# Outils : Google Chrome pour le rendu du SVG, sips et iconutil (livres avec
# macOS), node pour assembler le .ico.

DESKTOP="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

"${CHROME}" --headless --disable-gpu --hide-scrollbars \
  --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot="${WORK}/1024.png" "file://${DESKTOP}/icon.svg" >/dev/null 2>&1

# macOS : le SVG suit deja la grille d'Apple, marge comprise.
mkdir "${WORK}/icon.iconset"
for s in 16 32 128 256 512; do
  sips -z "${s}" "${s}" "${WORK}/1024.png" --out "${WORK}/icon.iconset/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "${d}" "${d}" "${WORK}/1024.png" --out "${WORK}/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "${WORK}/icon.iconset" -o "${DESKTOP}/icon.icns"

# Windows : l'Explorateur et la barre des taches n'ajoutent pas de marge, on
# recadre donc sur la tuile (824 px) en ne gardant que 16 px de bord.
sips -c 856 856 "${WORK}/1024.png" --out "${WORK}/tile.png" >/dev/null
SIZES="16 24 32 48 64 128 256"
for s in ${SIZES}; do
  sips -z "${s}" "${s}" "${WORK}/tile.png" --out "${WORK}/ico-${s}.png" >/dev/null
done

# Un .ico : un en-tete de 6 octets, une entree de 16 octets par taille, puis
# les PNG tels quels (format admis par Windows depuis Vista).
node - "${WORK}" "${DESKTOP}/icon.ico" ${SIZES} <<'EOF'
const fs = require('node:fs');
const [dir, out, ...rest] = process.argv.slice(2);
const sizes = rest.map(Number);
const pngs = sizes.map((s) => fs.readFileSync(`${dir}/ico-${s}.png`));
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2); // type : icone
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const e = 6 + 16 * i;
  head.writeUInt8(s % 256, e); // 0 veut dire 256
  head.writeUInt8(s % 256, e + 1);
  head.writeUInt16LE(1, e + 4); // plans
  head.writeUInt16LE(32, e + 6); // bits par pixel
  head.writeUInt32LE(pngs[i].length, e + 8);
  head.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
fs.writeFileSync(out, Buffer.concat([head, ...pngs]));
EOF

echo "icon.icns et icon.ico regeneres dans ${DESKTOP}"
