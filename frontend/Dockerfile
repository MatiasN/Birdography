FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runs as the unprivileged nginx user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.31-alpine
# Rendered with envsubst at startup by the image's entrypoint. A RAW+JPEG pair is one request, so this must exceed
# the backend's MAX_RAW_UPLOAD_MB + MAX_UPLOAD_MB (70 + 40 by default, plus a little for the multipart framing).
ENV CLIENT_MAX_BODY_SIZE=115m TRUSTED_PROXIES=
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 real-ip.sh /docker-entrypoint.d/40-real-ip.sh
COPY --from=build /app/dist /usr/share/nginx/html
