FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
ARG PUBLIC_PB_URL
ARG PUBLIC_TURNSTILE_SITE_KEY=
ARG PUBLIC_GOOGLE_ENABLED=0
ARG PUBLIC_SIM=0
ENV PUBLIC_SIM=$PUBLIC_SIM
ENV PUBLIC_PB_URL=$PUBLIC_PB_URL
ENV PUBLIC_TURNSTILE_SITE_KEY=$PUBLIC_TURNSTILE_SITE_KEY
ENV PUBLIC_GOOGLE_ENABLED=$PUBLIC_GOOGLE_ENABLED
RUN npm run check && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
COPY --from=build /app/build ./build
COPY --from=build /app/package*.json ./
COPY src/lib/server/sim/seed.ts ./src/lib/server/sim/
COPY src/lib/labels.ts ./src/lib/labels.ts
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
USER node
EXPOSE 3000
CMD ["node", "build"]
