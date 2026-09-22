FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG PUBLIC_PB_URL
ARG PUBLIC_SIM=0
ENV PUBLIC_SIM=$PUBLIC_SIM
ENV PUBLIC_PB_URL=$PUBLIC_PB_URL
RUN npm run check && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /app/build ./build
COPY --from=build /app/package*.json ./
COPY scripts/shared-rehearsal.mjs ./scripts/shared-rehearsal.mjs
COPY src/lib/server/sim/seed.ts src/lib/server/sim/shared.ts ./src/lib/server/sim/
COPY src/lib/labels.ts ./src/lib/labels.ts
COPY tests/fixtures/sim/recording ./rehearsal/recording
COPY src/lib/sim/shared-scenario.json ./rehearsal/scenario.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
USER node
EXPOSE 3000
CMD ["node", "build"]
