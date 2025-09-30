require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./database/connection');
// NOTE: notificationsRouter is loaded here, but relies on a function exported below
const notificationsRouter = require('./routes/notifications')
const axios = require('axios');
const nodemailer = require('nodemailer');
const paymentRoutes = require('./routes/payments');
const flash = require('connect-flash');
const crypto = require('crypto');


const app = express();
const PORT = 3000;


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

app.use(express.static(path.join(__dirname, 'public')));

// FIX 1: Encapsulated transporter creation into a function to prevent startup crash
function createEmailTransporter() {
    return nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.EMAIL,
            pass: process.env.EMAIL_PASSWORD,
        }
    });
}

// FIX 2: EXPORTED email sender function for use in the notifications router
const sendNotificationEmail = module.exports.sendNotificationEmail = async function (userId, subscription) {
    try {
        const userRow = await db.get('SELECT email FROM "Users" WHERE id = $1', [userId]);

        if (!userRow) { return; }

        const userEmail = userRow.email; 
        const subject = `Subscription Expiring Soon: ${subscription.subscription_name}`;
        const message = `Hello,\n\nYour subscription to ${subscription.subscription_name} is expiring soon on ${subscription.expiry}.\nPlease renew it to continue enjoying the benefits.\n\nBest regards,\nSubSage`;

        // Transporter is created safely inside the function call stack
        const transporter = createEmailTransporter(); 

        const mailOptions = {
            from: process.env.EMAIL, to: userEmail, subject: subject, text: message,
        };

        await transporter.sendMail(mailOptions);

        const insertEmailQuery = `
            INSERT INTO SentEmails (sender_email, receiver_email, subject, message, sent_at)
            VALUES ($1, $2, $3, $4, $5)
        `;
        const timestamp = new Date().toISOString();
        
        await db.run(insertEmailQuery, [
            process.env.EMAIL, userEmail, subject, message, timestamp
        ]);

    } catch (error) {
        console.error('Error in sendNotificationEmail:', error);
    }
};

// FIX 3: DELETED the standalone updateResetToken function definition.

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

        const user = await db.get("SELECT * FROM Users WHERE LOWER(email) = $1", [email.toLowerCase()]);

        if (!user) {
            return res.render('forgot-password', { message: 'If an account with that email exists, a reset link has been sent.' });
        }

        const token = crypto.randomBytes(20).toString('hex');
        const expireTime = Date.now() + 3600000;

        // FIX: Integrated the update logic here, replacing the standalone helper call.
        const updateQuery = "UPDATE Users SET reset_token = $1, reset_token_expiry = $2 WHERE LOWER(email) = $3";
        const updatedRows = await db.run(updateQuery, [token, expireTime, email.toLowerCase()]);
        // END FIX

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

        const user = await db.get("SELECT * FROM Users WHERE reset_token = $1 AND reset_token_expiry > $2", [token, Date.now()]);
        
        if (!user) {
            return res.render('reset-password', { token, email, message: 'Invalid or expired token.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const updateQuery = "UPDATE Users SET password = $1, reset_token = NULL, reset_token_expiry = NULL WHERE id = $2";
        await db.run(updateQuery, [hashedPassword, user.id]);

        res.render('reset-password', { token, email, message: 'Password updated successfully. Please log in with your new password.' });
    
    } catch (error) {
        console.error(error);
        return res.render('reset-password', { token, email, message: 'Error verifying reCAPTCHA. Please try again later.' });
    }
});


app.use('/notifications', notificationsRouter);
app.get('/', (req, res) => res.render('index'));
app.get('/signup', (req, res) => {
    res.render('signup', { message: null });
});

app.post('/auth/signup', async (req, res) => {
    const { email, username, password, 'g-recaptcha-response': reCAPTCHAResponse } = req.body;

    if (!reCAPTCHAResponse) return res.render('signup', { message: 'reCAPTCHA is required.' });

    try {
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const verificationResponse = await axios.post(verificationUrl, null, {
            params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: reCAPTCHAResponse }
        });
        if (!verificationResponse.data.success) {
            return res.render('signup', { message: 'reCAPTCHA verification failed. Please try again.' });
        }

        const existingUser = await db.get('SELECT id FROM Users WHERE email = $1', [email]);
        
        if (existingUser) {
            return res.render('signup', { message: 'User already exists.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const insertQuery = 'INSERT INTO Users (email, username, password) VALUES ($1, $2, $3)';
        await db.run(insertQuery, [email, username, hashedPassword]);

        return res.render('signup', { message: 'User registered successfully. You can now log in!' });

    } catch (error) {
        console.error('Error during sign up:', error);
        res.render('signup', { message: 'An internal error occurred during sign up.' });
    }
});

app.get('/login', (req, res) => {
    res.render('login', { message: null });
});

app.post('/auth/login', async (req, res) => {
    const { username, password, 'g-recaptcha-response': reCAPTCHAResponse } = req.body;

    if (!reCAPTCHAResponse) return res.render('login', { message: 'reCAPTCHA is required.' });

    try {
        const verificationUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const verificationResponse = await axios.post(verificationUrl, null, {
            params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: reCAPTCHAResponse }
        });
        if (!verificationResponse.data.success) {
            return res.render('login', { message: 'reCAPTCHA verification failed. Please try again.' });
        }

        const user = await db.get('SELECT * FROM Users WHERE username = $1', [username]);

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.render('login', { message: 'Invalid username or password.' });
        }

        req.session.user = { id: user.id, username: user.username };

        return res.redirect('/dashboard');

    } catch (error) {
        console.error('Error during login:', error);
        res.render('login', { message: 'An internal error occurred during login.' });
    }
});


app.use('/payments', paymentRoutes);

app.get('/transaction-history', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const userId = req.session.user.id;

    const sql = `
        SELECT 
            p.payment_id, p.subscription_name, p.amount, p.currency, 
            p.status, p.payment_method, p.payment_type, p.created_at, 
            pd.payer_name, pd.payer_email
        FROM Payments p
        LEFT JOIN PayerDetails pd ON p.payment_id = pd.payment_id
        WHERE p.user_id = $1
        ORDER BY p.created_at DESC
    `;

    try {
        const transactions = await db.all(sql, [userId]); 

        res.render('transaction-history', { transactions });
    } catch (err) {
        console.error("Error fetching transaction history:", err);
        return res.status(500).send("Error loading transaction history");
    }
});

app.get('/transaction-details/:paymentId', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const paymentId = req.params.paymentId;
    const userId = req.session.user.id;

    const sql = `
        SELECT 
            p.payment_id, p.subscription_name, p.amount, p.currency, 
            p.status, p.payment_method, p.payment_type, p.created_at, 
            pd.payer_name, pd.payer_email
        FROM Payments p
        LEFT JOIN PayerDetails pd ON p.payment_id = pd.payment_id
        WHERE p.payment_id = $1 AND p.user_id = $2 
    `;

    try {
        const transaction = await db.get(sql, [paymentId, userId]); 

        if (!transaction) {
            return res.status(404).send("Transaction not found or unauthorized access");
        }
        res.render('transaction-details', { transaction });
    } catch (err) {
        console.error("Error fetching transaction details:", err);
        return res.status(500).send("Error loading transaction details");
    }
});


app.get('/entertainment', (req, res) => res.render('entertainment'));
app.get('/utilities', (req, res) => res.render('utilities'));

app.use((req, res, next) => {
    res.locals.successMessageContact = req.session.successMessageContact || null;
    res.locals.successMessageReview = req.session.successMessageReview || null;

    delete req.session.successMessageContact;
    delete req.session.successMessageReview;

    next();
});

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
    const query = `INSERT INTO Contacts (name, email, message) VALUES ($1, $2, $3)`; 

    try {
        await db.run(query, [name, email, message]);
        
        req.session.successMessageContact = 'Your message has been sent successfully!';
        res.redirect('/contact');
    } catch (err) {
        console.error(err);
        return res.status(500).send('Failed to save message');
    }
});

app.post('/submit-review', async (req, res) => {
    if (!req.session || !req.session.user) return res.redirect('/contact');

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

app.get('/addSubscription', (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const user = req.session.user; 
    const name = req.query.name || ''; 
    const type = req.query.type || ''; 

    res.render('addSubscription', { user: user, name: name, type: type });
});


app.get('/add-subscription', (req, res) => {
    const name = req.query.name || ''; 
    res.render('addSubscription', { name: name });
});


app.get('/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const userId = req.session.user.id;
    let subscriptionResults = [], paymentResults = [], payerResults = { uniquepayers: 0 };
    
    try {
        const subscriptionQuery = `
            SELECT TO_CHAR(start::date, 'MM') AS month, name, COUNT(*) AS count
            FROM Subscriptions
            WHERE user_id = $1
            GROUP BY 1, 2
            ORDER BY 1;
        `;
        subscriptionResults = await db.all(subscriptionQuery, [userId]);

        const paymentQuery = `
            SELECT TO_CHAR(created_at::date, 'MM') AS month, subscription_name, SUM(amount) AS amount
            FROM Payments
            WHERE user_id = $1
            GROUP BY 1, 2
            ORDER BY 1;
        `;
        paymentResults = await db.all(paymentQuery, [userId]);

        const payerQuery = `
            SELECT COUNT(DISTINCT payer_email) AS "uniquePayers"
            FROM PayerDetails
            WHERE user_id = $1;
        `;
        const result = await db.get(payerQuery, [userId]);
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

app.get('/notifications', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');

    const userId = req.session.user.id;
    const currentDate = new Date().toISOString();
    const nextWeekDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const query = `
        SELECT * FROM Subscriptions
        WHERE user_id = $1 AND expiry BETWEEN $2 AND $3
    `;

    try {
        const subscriptions = await db.all(query, [userId, currentDate, nextWeekDate]);
        
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

app.use('/auth', authRoutes);
app.use('/subscriptions', subscriptionRoutes);
app.use('/notifications', notificationsRouter);

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).send('Error logging out');
        }
        res.redirect('/');
    });
});

app.use((req, res) => {
    res.status(404).render('404');
});


module.exports = app;
