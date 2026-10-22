FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libreoffice-writer \
       python3-minimal \
       fontconfig \
       fonts-dejavu-core \
       fonts-liberation2 \
       fonts-roboto-unhinted \
       fonts-crosextra-carlito \
       fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]