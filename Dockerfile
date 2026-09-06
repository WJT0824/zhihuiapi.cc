FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
COPY package.json ./
COPY server ./server
COPY web ./web
RUN mkdir -p /app/data
EXPOSE 8787
CMD ["node", "server/index.mjs"]
