require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./database/connection'); 
const axios = require('axios');
const nodemailer = require('nodemailer'); 
const flash = require('connect-flash'); 
const crypto = require('crypto');

// --- UTILITY IMPORTS (Required for stability and modularity) ---
const { ensureAuthenticated } = require('./utils/authUtils');
const { createEmailTransporter } = require('./utils/email'); 

// Router imports
const paymentsRouter = require('./routes/payments'); 
const notificationsRouter = require('./routes/notifications');
const authRoutes = require('./routes/auth');
const subscriptionRoutes = require('./routes/subscription');


const app = express();
const PORT = 3000;

// CRITICAL FIX 1: Trust the proxy headers (MANDATORY for Vercel/HTTPS deployment)
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        // CRITICAL FIX 2: Set secure to true because your deployment uses HTTPS
        secure: true, 
        // CRITICAL FIX 3: Add SameSite for security and compatibility
        sameSite: 'lax' 
    }
}));

app.use(flash()); 
app.use(express.static(path.join(__dirname, 'public')));


// GLOBAL MIDDLEWARE: Make flash messages and user info available to all templates
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.successMessageContact = req.session.successMessageContact || null;
    res.locals.successMessageReview = req.session.successMessageReview || null;
    
    delete req.session.successMessageContact;
    delete req.session.successMessageReview;

    res.locals.error = req.flash('error');
    res.locals.success = req.flash('success');

    // CRITICAL: Prevent accidental rendering if middleware starts a response.
    if (res.headersSent) {
        return;
    }

    next();
});

// --- AUTHENTICATION ROUTES (NON-ROUTER LOGIC: Password Reset) ---

app.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { message: null });
});

app.post('/forgot-password', async (req, res) => {
    try {
        const { email, 'g-recaptcha-response': recaptchaResponse } = req.body;
        if (!recaptchaResponse) {
            return res.render('forgot-password', { message: 'reCAPTCHA is required.' });
        }

        const recaptchaVerifyResponse = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
            params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: recaptchaResponse }
        });
        if (!recaptchaVerifyResponse.data.success) {
            return res.render('forgot-password', { message: 'reCAPTCHA verification failed. Please try again.' });
        }

        const user = await db.get("SELECT * FROM users WHERE LOWER(email) = $1", [email.toLowerCase()]);

        if (!user) {
            return res.render('forgot-password', { message: 'If an account with that email exists, a reset link has been sent.' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expireTime = Date.now() + 3600000; 

        const updateQuery = "UPDATE users SET reset_token = $1, reset_token_expiry = $2 WHERE LOWER(email) = $3";
        const updatedRows = await db.run(updateQuery, [token, expireTime, email.toLowerCase()]);

        if (updatedRows === 0) {
            return res.render('forgot-password', { message: 'Error updating reset token. Please try again.' });
        }

        const resetLink = `http://localhost:3000/reset-password?token=${token}&email=${email}`;

        const mailOptions = {
            from: process.env.EMAIL, to: email, subject: 'Password Reset', text: `Click the link to reset your password: ${resetLink}`
        };

        const transporter = createEmailTransporter();

        transporter.sendMail(mailOptions, (emailErr) => {
            if (emailErr) {
                console.error("Error sending email:", emailErr);
                return res.render('forgot-password', { message: 'Error sending email. Please try again later.' });
            }
            res.render('forgot-password', { message: 'If an account with that email exists, a reset link has been sent.' });
        });

    } catch (error) {
        console.error("Error:", error);
        return res.render('forgot-password', { message: 'An error occurred. Please try again later.' });
    }
});


app.get('/reset-password', (req, res) => {
    const { token, email } = req.query;

    if (!token || !email) {
        return res.status(400).send("Invalid or missing parameters.");
    }
    res.render('reset-password', { token, email, message: null });
});

app.post('/reset-password', async (req, res) => {
    const { token, email, password, 'g-recaptcha-response': recaptchaResponse } = req.body;

    if (!recaptchaResponse) return res.render('reset-password', { token, email, message: 'reCAPTCHA is required.' });

    try {
        const recaptchaVerifyResponse = await axios.post('https://www.google.com/recaptcha/api/siteverify', null, {
            params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: recaptchaResponse }
        });
        if (!recaptchaVerifyResponse.data.success) {
            return res.render('reset-password', { token, email, message: 'reCAPTCHA verification failed. Please try again.' });
        }

        const user = await db.get("SELECT * FROM users WHERE reset_token = $1 AND reset_token_expiry > $2", [token, Date.now()]);

        if (!user) {
            return res.render('reset-password', { token, email, message: 'Invalid or expired token.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const updateQuery = "UPDATE users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2";
        await db.run(updateQuery, [hashedPassword, user.id]);

        res.render('reset-password', { token, email, message: 'Password updated successfully. Please log in with your new password.' });

    } catch (error) {
        console.error(error);
        return res.render('reset-password', { token, email, message: 'Error verifying reCAPTCHA. Please try again later.' });
    }
});


// --- ROUTER MOUNTING ---
app.use('/auth', authRoutes);
app.use('/subscriptions', subscriptionRoutes);
app.use('/notifications', notificationsRouter);
app.use('/payments', paymentsRouter);


// --- PUBLIC ROUTES ---
app.get('/', (req, res) => res.render('index'));

app.get('/signup', (req, res) => {
    res.render('signup', { message: req.flash('success') || null });
});

app.get('/login', (req, res) => {
    res.render('login', { message: req.flash('error') || req.flash('success') || null });
});


app.get('/entertainment', (req, res) => res.render('entertainment'));
app.get('/utilities', (req, res) => res.render('utilities'));


app.get('/contact', async (req, res) => {
    try {
        const reviews = await db.all(
            'SELECT name, rating, review_text, created_at FROM reviews ORDER BY created_at DESC LIMIT 4'
        );

        res.render('contact', {
            reviews: reviews,
            successMessageContact: res.locals.successMessageContact,
            successMessageReview: res.locals.successMessageReview
        });

    } catch (error) {
        console.error('Unexpected error:', error);
        res.status(500).send('An error occurred while loading the contact page.');
    }
});

app.post('/submit-contact', async (req, res) => {
    const { name, email, message } = req.body;
    const query = `INSERT INTO contacts (name, email, message) VALUES ($1, $2, $3)`;

    try {
        await db.run(query, [name, email, message]);

        req.session.successMessageContact = 'Your message has been sent successfully!';
        res.redirect('/contact');
    } catch (err) {
        console.error(err);
        return res.status(500).send('Failed to save message');
    }
});

app.post('/submit-review', ensureAuthenticated, async (req, res) => {
    const { id: userId } = req.session.user;
    const { name, email, rating, review_text } = req.body;

    if (!email || !rating || !review_text) return res.redirect('/contact');

    const query = `INSERT INTO reviews (user_id, name, email, rating, review_text) VALUES ($1, $2, $3, $4, $5)`;

    try {
        await db.run(query, [userId, name, email, rating, review_text]);

        req.session.successMessageReview = 'Your review has been submitted successfully!';
        res.redirect('/contact');
    } catch (err) {
        console.error('Error submitting review:', err);
        return res.status(500).send('Failed to submit review.');
    }
});

// --- PROTECTED ROUTES (Using ensureAuthenticated middleware) ---

app.get('/transaction-history', ensureAuthenticated, async (req, res) => {
    const userId = req.session.user.id;
    
    const sql = `
    SELECT
    p.payment_id, p.subscription_name, p.amount, p.currency,
    p.status, p.payment_method, p.payment_type, p.created_at,
    pd.payer_name, pd.payer_email
    FROM payments p
    LEFT JOIN payerdetails pd ON p.payment_id = pd.payment_id
    WHERE p.user_id = $1
    ORDER BY p.created_at DESC
    `;

    try {
        const transactions = await db.all(sql.trim(), [userId]);

        res.render('transaction-history', { transactions });
    } catch (err) {
        console.error("Error fetching transaction history:", err);
        return res.status(500).send("Error loading transaction history");
    }
});

app.get('/transaction-details/:paymentId', ensureAuthenticated, async (req, res) => {
    const paymentId = req.params.paymentId;
    const userId = req.session.user.id;

    const sql = `
    SELECT
    p.payment_id, p.subscription_name, p.amount, p.currency,
    p.status, p.payment_method, p.payment_type, p.created_at,
    pd.payer_name, pd.payer_email
    FROM payments p
    LEFT JOIN payerdetails pd ON p.payment_id = pd.payment_id
    WHERE p.payment_id = $1 AND p.user_id = $2
    `;

    try {
        const transaction = await db.get(sql.trim(), [paymentId, userId]);

        if (!transaction) {
            return res.status(404).send("Transaction not found or unauthorized access");
        }
        res.render('transaction-details', { transaction });
    } catch (err) {
        console.error("Error fetching transaction details:", err);
        return res.status(500).send("Error loading transaction details");
    }
});

app.get('/dashboard', ensureAuthenticated, async (req, res) => {
    const userId = req.session.user.id;
    let subscriptionResults = [], paymentResults = [], payerResults = { uniquepayers: 0 };

    try {
        const subscriptionQuery = `
        SELECT TO_CHAR(start::date, 'MM') AS month, name, COUNT(*) AS count
        FROM subscriptions
        WHERE user_id = $1
        GROUP BY 1, 2
        ORDER BY 1;
        `;
        subscriptionResults = await db.all(subscriptionQuery.trim(), [userId]);

        const paymentQuery = `
        SELECT TO_CHAR(created_at::date, 'MM') AS month, subscription_name, SUM(amount) AS amount
        FROM payments
        WHERE user_id = $1
        GROUP BY 1, 2
        ORDER BY 1;
        `;
        paymentResults = await db.all(paymentQuery.trim(), [userId]);

        const payerQuery = `
        SELECT COUNT(DISTINCT payer_email) AS "uniquePayers"
        FROM payerdetails
        WHERE user_id = $1;
        `;
        const result = await db.get(payerQuery.trim(), [userId]);
        payerResults = result;

    } catch (err) {
        console.error("Error fetching dashboard data:", err);
        return res.status(500).send("Database error while loading dashboard.");
    }

    res.render('dashboard', {
        username: req.session.user.username,
        message: req.session.message,
        subscriptionData: subscriptionResults,
        paymentData: paymentResults,
        uniquePayers: payerResults ? payerResults.uniquePayers : 0
    });

    req.session.message = null;
});

app.get('/notifications', ensureAuthenticated, async (req, res) => {
    const userId = req.session.user.id;
    const currentDate = new Date().toISOString();
    const nextWeekDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const query = `
    SELECT * FROM subscriptions
    WHERE user_id = $1 AND expiry BETWEEN $2 AND $3
    `;

    try {
        const subscriptions = await db.all(query.trim(), [userId, currentDate, nextWeekDate]);

        const notifications = subscriptions.map(subscription => {
            return {
                subscription_id: subscription.id,
                subscription_name: subscription.name,
                subscription_type: subscription.type,
                message: `Your subscription to ${subscription.name} will expire soon!`,
                notified_at: new Date().toISOString()
            };
        });
        res.render('notifications', { notifications });
    } catch (err) {
        console.error('Error fetching subscriptions:', err);
        return res.status(500).send('Error fetching subscriptions');
    }
});


app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Error logging out');
        }
        res.redirect('/');
    });
});

app.use((req, res, next) => {
    // CRITICAL FIX: If headers have already been sent (meaning a response was attempted 
    // elsewhere, likely the subscription POST handler), stop execution.
    if (res.headersSent) {
        return;
    }
    res.status(404).render('404');
});


module.exports = app;
