const { openDatabase } = require('./db');
const { createApp } = require('./app');
const { initialiserAdmin } = require('./auth');

const port = Number(process.env.PORT) || 3000;
const db = openDatabase();
initialiserAdmin(db);

createApp(db).listen(port, () => {
  console.log(`Gestion de stocks disponible sur http://localhost:${port}`);
});
