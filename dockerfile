FROM node:22.14.0-alpine
WORKDIR /app

COPY --chown=node:node . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/map > /dev/null || exit 1

CMD ["npm", "start"]