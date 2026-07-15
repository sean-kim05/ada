# Ada frontend — Vite build served as static files by nginx.
# Stage 1: build the SPA. Stage 2: serve the built /dist with nginx.
#
# NOTE: src/lib/ada.ts points the API/WS client at 127.0.0.1:8000, so the
# browser talks to the backend directly (its port is published on the host).
# That works for same-machine (localhost) use. To reach Ada from another
# device, switch ada.ts to relative URLs and let nginx proxy /api + /ws.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
