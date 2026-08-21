FROM node:22-bookworm-slim

WORKDIR /flutter
COPY package.json package-lock.json ./
COPY packages/shared ./packages/shared
COPY apps/daemon ./apps/daemon
RUN npm install --omit=dev --workspace=@flutter-software/daemon --workspace=@flutter-software/shared \
  && npm install --omit=dev tsx

WORKDIR /flutter/apps/daemon
EXPOSE 8080
CMD ["npx", "tsx", "src/index.ts"]
