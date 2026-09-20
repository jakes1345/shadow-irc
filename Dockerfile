FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 6667 8888

ENV NODE_ENV=production
ENV PORT=6667
ENV WEB_PORT=8888

CMD ["node", "src/server/ircd.js"]
