'use strict';

const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

const app = createApp();
const server = app.listen(PORT, HOST, () => {
  console.log(`Blog běží na http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      app.close();
      process.exit(0);
    });
  });
}
