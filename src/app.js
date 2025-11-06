const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const authRoutes = require('./routes/auth.route');
const clientJobRoutes = require('./routes/clientJob.route');
const itemRoutes = require('./routes/item.route');
const marketplaceRoutes = require('./routes/marketplace.route');
const cartRoutes = require('./routes/cart.routes');
const checkoutRoutes = require('./routes/checkout.route');
const orderRoutes = require('./routes/orders.route');
const webhookRoutes = require('./routes/webhook.route');
const emailTemplateRoutes = require('./routes/emailTemplates.routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(morgan('dev'));

app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/client-jobs', clientJobRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/email-templates', emailTemplateRoutes);

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'dev', time: new Date().toISOString() });
});

module.exports = app;
