# Etape de build : Angular 22 exige node ^22.22.3 || ^24.15.0 || >=26.0.0
# (start.sh le controle aussi). node:20 echoue au demarrage du CLI.
FROM node:22-alpine AS build
WORKDIR /app

# package.json + package-lock.json seuls d'abord : la couche npm ci n'est
# reconstruite que quand les dependances bougent, pas a chaque edition de src/.
COPY package*.json ./

# Le lock resout ses 504 paquets sur un miroir npm
# non public — une image
# publique ne peut dependre ni de l'un ni de l'autre. On repointe donc les URL
# sur le registre public.
#
# C'est sans effet sur ce qui est installe : aucune dependance n'est privee
# (tous les scopes du lock sont publics), les versions sont celles du lock, et
# les hashes « integrity » restent verifies — mirror n'est ici qu'un miroir de
# registry.npmjs.org. Seule l'origine du telechargement change.
#
# --replace-registry-host ne suffirait pas : il remplace l'hote sans retirer le
# prefixe /repository/npm/ du chemin, et npm tombe alors en 404.
RUN sed -i 's#https://registry.npmjs.org/#https://registry.npmjs.org/#g' package-lock.json \
 && npm ci --registry=https://registry.npmjs.org --no-audit --no-fund

COPY . .
# Configuration production par defaut (angular.json), sortie dans
# dist/json-viewer/browser. Pas de --base-href : index.html porte <base href="/">
# et l'app est servie a la racine.
RUN npm run build

# Etape d'execution : serveur statique, rien d'autre. L'app est entierement
# cliente — pas de backend, pas de variable a injecter au runtime, donc pas
# d'entrypoint custom : le CMD de l'image nginx suffit.
FROM nginx:alpine
COPY --from=build /app/dist/json-viewer/browser /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
