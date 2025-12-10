const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth.route');
const clientJobRoutes = require('./routes/clientJob.route');
const itemRoutes = require('./routes/item.route');
const marketplaceRoutes = require('./routes/marketplace.route');
const cartRoutes = require('./routes/cart.routes');
const checkoutRoutes = require('./routes/checkout.route');
const orderRoutes = require('./routes/orders.route');
const webhookRoutes = require('./routes/webhook.route');
const emailTemplateRoutes = require('./routes/emailTemplates.routes');
const fileUploadRoutes = require('./routes/fileupload.routes');
const docusignRoutes = require('./routes/docusign');
const vendorRoutes = require('./routes/vendor.route');
const crmRoutes = require('./routes/crm.route');

const app = express();

app.use(helmet());
app.use(compression());

const allowedOrigins = [
  'https://keptestate.com',
  'https://www.keptestate.com',
  'https://kept-frontend-eta.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

const isProduction = process.env.NODE_ENV === 'production';
app.use(morgan(isProduction ? 'combined' : 'dev'));

app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

app.use('/api/files', fileUploadRoutes);

app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/client-jobs', clientJobRoutes);
app.use('/api/items', itemRoutes);
app.use('/api/marketplace', marketplaceRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/email-templates', emailTemplateRoutes);
app.use('/api/docusign', docusignRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/crm', crmRoutes);

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'dev', time: new Date().toISOString() });
});

module.exports = app;
