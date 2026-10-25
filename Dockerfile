FROM node:22.23.4-bookworm-slim

ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       libreoffice-writer \
       libreoffice-impress \
       python3-minimal \
       fontconfig \
       fonts-dejavu-core \
       fonts-liberation2 \
       fonts-roboto-unhinted \
       fonts-crosextra-carlito \
       fonts-crosextra-caladea \
    && update-ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN test "$(node --version)" = "v22.23.4" \
    && test -s /etc/ssl/certs/ca-certificates.crt

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]