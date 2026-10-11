const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: '', database: 'ereputation1' });
  const [rows] = await conn.query('SELECT data FROM ghostroar_resources LIMIT 1');
  console.log('TYPE: ' + typeof rows[0].data);
  console.log('VALUE: ' + String(rows[0].data).substring(0, 120));
  await conn.end();
})();
