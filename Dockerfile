FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.build.json ./
COPY api ./api
COPY web ./web

RUN npm ci
RUN npm run build:api
RUN npm prune --omit=dev

FROM node:24-alpine

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/idl ./api/idl
COPY --from=build /app/web ./web

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["node", "--enable-source-maps", "./api/dist/server.js"]
