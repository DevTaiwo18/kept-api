require('dotenv').config();
const app = require('./app');
const { connectDB } = require('./config/db');

(async () => {
  if (!process.env.MONGO_URI) {
    console.warn('⚠️  MONGO_URI not set — starting API without DB');
  } else {
    await connectDB(process.env.MONGO_URI);
  }
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`✅ API up: http://localhost:${port}/health`));
})();
