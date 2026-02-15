# ---- build ----
FROM node:lts-alpine AS build
LABEL authors="hypeserv"
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY . .
RUN npm i -D typescript
RUN npx tsc

# ---- runtime ----
FROM node:lts-alpine AS deploy
WORKDIR /app
ENV NODE_ENV=production

# only copy what runtime needs
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
USER node

ENTRYPOINT ["node", "dist/index.js"]