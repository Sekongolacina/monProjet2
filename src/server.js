const { openDatabase } = require('./db');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const app = createApp(openDatabase());

app.listen(port, () => {
  console.log(`Gestion de stocks disponible sur http://localhost:${port}`);
});
