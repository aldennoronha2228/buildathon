# --- Build the React client ---
FROM node:22-bookworm-slim AS client-build
WORKDIR /app
COPY client/package.json client/package-lock.json* ./client/
COPY package.json package-lock.json* ./
RUN npm install --workspace client --include-workspace-root
COPY client ./client
RUN npm run build --workspace client

# --- Production image: Node server serving API + built client ---
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json* ./server/
COPY package.json package-lock.json* ./
RUN npm install --workspace server --include-workspace-root
COPY server ./server
COPY --from=client-build /app/client/dist ./client/dist
EXPOSE 8080
CMD ["npm", "run", "start", "--workspace", "server"]
