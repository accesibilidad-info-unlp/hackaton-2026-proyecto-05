FROM node:22.14.0-alpine
WORKDIR /app

COPY --chown=node:node . .

ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["npm", "start"]