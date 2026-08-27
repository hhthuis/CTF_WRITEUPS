FROM oven/bun:1

WORKDIR /app

COPY package.json server.ts index.html ./

ENV PORT=80
EXPOSE 80

CMD ["bun", "server.ts"]
