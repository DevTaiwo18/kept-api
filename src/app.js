const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const authRoutes = require('./routes/auth.route');
const clientJobRoutes = require('./routes/clientJob.route');
const itemRoutes = require('./routes/item.route');


const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*'}));
app.use(morgan('dev'));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/client-jobs', clientJobRoutes);
app.use('/api/items', itemRoutes);

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'dev', time: new Date().toISOString() });
});

module.exports = app;
