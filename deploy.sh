#!/usr/bin/env bash
set -euo pipefail

# Construit l'image du viewer et la publie sur le compte Docker Hub pwarnon.
#
#   ./deploy.sh          -> pwarnon/json-viewer:latest
#   ./deploy.sh 1.0.0    -> pwarnon/json-viewer:1.0.0 ET :latest
#
# Prerequis : docker login (compte pwarnon).

REGISTRY="pwarnon"
IMAGE="${REGISTRY}/json-viewer"
TAG="${1:-latest}"
BUILDER="json-viewer"
PLATFORMS="linux/amd64,linux/arm64"

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Le driver buildx par defaut (« docker ») ne sait pas construire pour plusieurs
# plateformes : il faut un builder docker-container. La premiere execution
# telecharge l'image moby/buildkit.
if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
  echo "==> Creation du builder buildx « ${BUILDER} » (multi-plateforme)..."
  docker buildx create --name "${BUILDER}" --driver docker-container >/dev/null
fi

# buildx pousse un manifest list : on ne peut pas le retagger localement apres
# coup comme on le ferait avec docker tag. Les deux tags partent donc du meme
# build.
TAGS=(-t "${IMAGE}:${TAG}")
if [ "${TAG}" != "latest" ]; then
  TAGS+=(-t "${IMAGE}:latest")
fi

echo "==> Construction et publication de ${IMAGE}:${TAG} (${PLATFORMS})..."
if ! docker buildx build \
  --builder "${BUILDER}" \
  --platform "${PLATFORMS}" \
  "${TAGS[@]}" \
  --push \
  "${ROOT}"; then
  echo ""
  echo "Echec. Si le push a ete refuse, authentifiez-vous d'abord :" >&2
  echo "  docker login -u ${REGISTRY}" >&2
  exit 1
fi

echo ""
echo "Images disponibles :"
echo "  ${IMAGE}:${TAG}"
[ "${TAG}" != "latest" ] && echo "  ${IMAGE}:latest"
echo ""
echo "Pour la lancer seule :"
echo "  docker run --rm -p 5176:80 ${IMAGE}:${TAG}"
echo ""
echo "Elle est aussi montee par la pile compose-stack :"
echo "  cd ../compose-stack/src/main/docker && docker compose up -d json-viewer"
