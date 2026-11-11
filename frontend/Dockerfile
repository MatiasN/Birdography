FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.29-alpine
# Rendered with envsubst at startup by the image's entrypoint; must exceed the backend's MAX_RAW_UPLOAD_MB.
ENV CLIENT_MAX_BODY_SIZE=75m
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
