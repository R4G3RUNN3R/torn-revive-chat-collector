FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --chown=node:node src ./src

USER node

EXPOSE 3100

CMD ["npm", "run", "start"]
